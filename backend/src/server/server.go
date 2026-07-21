package server

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"linkhub/backend/src/db"
	"linkhub/backend/src/s3"

	"github.com/gin-gonic/gin"
	"github.com/go-redis/go-redis/v9"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
)

var JwtSecret = []byte("linkhub_jwt_super_secret_key")

type Claims struct {
	ID    int    `json:"id"`
	Email string `json:"email"`
	jwt.RegisteredClaims
}

type User struct {
	ID            int    `json:"id"`
	Email         string `json:"email"`
	PasswordHash  string `json:"-"`
	MasterKeySalt string `json:"masterKeySalt"`
}

type Bookmark struct {
	ID           int       `json:"id"`
	UserID       int       `json:"userId"`
	URL          string    `json:"url"`
	Title        string    `json:"title"`
	Summary      string    `json:"summary"`
	IsFavorite   bool      `json:"is_favorite"`
	CategoryID   *int      `json:"category_id"`
	CategoryName *string   `json:"category_name,omitempty"`
	Distance     *float64  `json:"distance,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
	Tags         []Tag     `json:"tags"`
	Assets       []string  `json:"assets"`
}

type Category struct {
	ID            int     `json:"id"`
	UserID        int     `json:"userId"`
	Name          string  `json:"name"`
	Description   *string `json:"description"`
	BookmarkCount int     `json:"bookmark_count"`
}

type Tag struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

// CORSMiddleware configuration
func CORSMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, accept, origin, Cache-Control, X-Requested-With, X-Encryption-Key")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS, GET, PUT, PATCH, DELETE")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	}
}

// AuthMiddleware extracts JWT tokens and sets context values
func AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication token missing."})
			c.Abort()
			return
		}

		parts := strings.Split(authHeader, " ")
		if len(parts) != 2 || parts[0] != "Bearer" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid Authorization header format."})
			c.Abort()
			return
		}

		tokenStr := parts[1]
		claims := &Claims{}

		token, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (interface{}, error) {
			return JwtSecret, nil
		})

		if err != nil || !token.Valid {
			c.JSON(http.StatusForbidden, gin.H{"error": "Invalid or expired token."})
			c.Abort()
			return
		}

		c.Set("userID", claims.ID)
		c.Set("userEmail", claims.Email)
		c.Next()
	}
}

// StartServer registers routes and runs the router
func StartServer(redisClient *redis.Client) {
	if secret := os.Getenv("JWT_SECRET"); secret != "" {
		JwtSecret = []byte(secret)
	}

	r := gin.Default()
	r.Use(CORSMiddleware())
	r.Use(func(c *gin.Context) {
		c.Set("redis", redisClient)
		c.Next()
	})

	// Auth routes
	r.GET("/api/auth/salt", getAuthSalt)
	r.POST("/api/auth/register", registerUser)
	r.POST("/api/auth/login", loginUser)

	// Protected routes group
	protected := r.Group("/api")
	protected.Use(AuthMiddleware())
	{
		protected.GET("/auth/me", getProfile)
		protected.GET("/categories", getCategories)
		protected.POST("/categories", createCategory)
		protected.GET("/tags", getTags)
		protected.GET("/bookmarks", getBookmarks)
		protected.POST("/bookmarks/ingest", ingestBookmark)
		protected.PATCH("/bookmarks/:id/favorite", toggleFavorite)
		protected.DELETE("/bookmarks/:id", deleteBookmark)
		protected.GET("/bookmarks/:id/assets", getBookmarkAssets)
		protected.GET("/bookmarks/:id/assets/:type", downloadAssetPayload)
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "5000"
	}
	log.Printf("LinkHub API Server running on port %s\n", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("API server execution failed: %v\n", err)
	}
}

// ==========================================
// ROUTE CONTROLLERS
// ==========================================

func getAuthSalt(c *gin.Context) {
	email := c.Query("email")
	if email == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Email is required."})
		return
	}

	var salt string
	err := db.Pool.QueryRow(context.Background(),
		"SELECT master_key_salt FROM users WHERE email = $1",
		email,
	).Scan(&salt)

	if err == nil {
		c.JSON(http.StatusOK, gin.H{"salt": salt})
		return
	}

	// Deterministic fallback to prevent email enumeration
	hasher := sha256.New()
	hasher.Write([]byte(email + "linkhub_auth_determinism_secret_key"))
	fakeSalt := hex.EncodeToString(hasher.Sum(nil))[:32]
	c.JSON(http.StatusOK, gin.H{"salt": fakeSalt})
}

func registerUser(c *gin.Context) {
	var req struct {
		Email         string `json:"email"`
		PasswordHash  string `json:"passwordHash"`
		MasterKeySalt string `json:"masterKeySalt"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Missing registration parameters."})
		return
	}

	// Check user existence
	var exists int
	err := db.Pool.QueryRow(context.Background(), "SELECT id FROM users WHERE email = $1", req.Email).Scan(&exists)
	if err == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "User with this email already exists."})
		return
	}

	serverHashBytes, err := bcrypt.GenerateFromPassword([]byte(req.PasswordHash), 10)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Server error salting credential."})
		return
	}

	var userID int
	err = db.Pool.QueryRow(context.Background(),
		"INSERT INTO users (email, password_hash, master_key_salt) VALUES ($1, $2, $3) RETURNING id",
		req.Email, string(serverHashBytes), req.MasterKeySalt,
	).Scan(&userID)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Registration execution failed."})
		return
	}

	tokenStr, err := generateToken(userID, req.Email)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to sign authentication token."})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"token": tokenStr,
		"user": gin.H{
			"id":            userID,
			"email":         req.Email,
			"masterKeySalt": req.MasterKeySalt,
		},
	})
}

func loginUser(c *gin.Context) {
	var req struct {
		Email        string `json:"email"`
		PasswordHash string `json:"passwordHash"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Missing login credentials."})
		return
	}

	var user User
	err := db.Pool.QueryRow(context.Background(),
		"SELECT id, email, password_hash, master_key_salt FROM users WHERE email = $1",
		req.Email,
	).Scan(&user.ID, &user.Email, &user.PasswordHash, &user.MasterKeySalt)

	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid email or password."})
		return
	}

	err = bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.PasswordHash))
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid email or password."})
		return
	}

	tokenStr, err := generateToken(user.ID, user.Email)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to sign token."})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"token": tokenStr,
		"user": gin.H{
			"id":            user.ID,
			"email":         user.Email,
			"masterKeySalt": user.MasterKeySalt,
		},
	})
}

func getProfile(c *gin.Context) {
	userID := c.MustGet("userID").(int)

	var user User
	err := db.Pool.QueryRow(context.Background(),
		"SELECT id, email, master_key_salt FROM users WHERE id = $1",
		userID,
	).Scan(&user.ID, &user.Email, &user.MasterKeySalt)

	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User profile not found."})
		return
	}

	c.JSON(http.StatusOK, user)
}

func getCategories(c *gin.Context) {
	userID := c.MustGet("userID").(int)

	rows, err := db.Pool.Query(context.Background(),
		`SELECT c.id, c.name, c.description, COUNT(b.id) as bookmark_count 
		 FROM categories c 
		 LEFT JOIN bookmarks b ON c.id = b.category_id 
		 WHERE c.user_id = $1 
		 GROUP BY c.id 
		 ORDER BY c.name ASC`,
		userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to query folders."})
		return
	}
	defer rows.Close()

	categories := []Category{}
	for rows.Next() {
		var cat Category
		err = rows.Scan(&cat.ID, &cat.Name, &cat.Description, &cat.BookmarkCount)
		if err == nil {
			categories = append(categories, cat)
		}
	}

	c.JSON(http.StatusOK, categories)
}

func createCategory(c *gin.Context) {
	userID := c.MustGet("userID").(int)

	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}

	if err := c.ShouldBindJSON(&req); err != nil || req.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Folder name is required."})
		return
	}

	var cat Category
	err := db.Pool.QueryRow(context.Background(),
		"INSERT INTO categories (user_id, name, description) VALUES ($1, $2, $3) RETURNING id, name, description",
		userID, req.Name, req.Description,
	).Scan(&cat.ID, &cat.Name, &cat.Description)

	if err != nil {
		if strings.Contains(err.Error(), "unique") || strings.Contains(err.Error(), "23505") {
			c.JSON(http.StatusConflict, gin.H{"error": "A category with this name already exists."})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create folder."})
		return
	}

	c.JSON(http.StatusCreated, cat)
}

func getTags(c *gin.Context) {
	userID := c.MustGet("userID").(int)

	rows, err := db.Pool.Query(context.Background(),
		"SELECT id, name FROM tags WHERE user_id = $1 ORDER BY name ASC",
		userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch tags."})
		return
	}
	defer rows.Close()

	tags := []Tag{}
	for rows.Next() {
		var t Tag
		if err := rows.Scan(&t.ID, &t.Name); err == nil {
			tags = append(tags, t)
		}
	}

	c.JSON(http.StatusOK, tags)
}

func getBookmarks(c *gin.Context) {
	userID := c.MustGet("userID").(int)
	catIDStr := c.Query("categoryId")
	tagIDStr := c.Query("tagId")
	isFavStr := c.Query("isFavorite")
	q := c.Query("q")
	semantic := c.Query("semantic")

	var bookmarks []Bookmark
	var err error
	var rows pgx.Rows

	// 1. Vector Semantic Cosine Search
	if q != "" && semantic == "true" {
		queryVector, errEmbed := getOllamaEmbedding(q)
		if errEmbed != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "AI embedding server unavailable."})
			return
		}
		vectorJson, _ := json.Marshal(queryVector)

		sql := `
			SELECT b.id, b.url, b.title, b.summary, b.is_favorite, b.category_id, c.name as category_name, b.created_at,
			       (b.raw_text_vector <=> $1::vector) AS distance
			FROM bookmarks b
			LEFT JOIN categories c ON b.category_id = c.id
			WHERE b.user_id = $2 AND b.raw_text_vector IS NOT NULL
		`
		params := []interface{}{string(vectorJson), userID}
		paramCount := 2

		if catIDStr != "" {
			catID, _ := strconv.Atoi(catIDStr)
			paramCount++
			sql += " AND b.category_id = $" + strconv.Itoa(paramCount)
			params = append(params, catID)
		}

		sql += " ORDER BY distance ASC LIMIT 50"

		rows, err = db.Pool.Query(context.Background(), sql, params...)
	} else {
		// 2. Standard Search & Filtering
		sql := `
			SELECT DISTINCT b.id, b.url, b.title, b.summary, b.is_favorite, b.category_id, c.name as category_name, b.created_at
			FROM bookmarks b
			LEFT JOIN categories c ON b.category_id = c.id
			LEFT JOIN bookmark_tags bt ON b.id = bt.bookmark_id
			WHERE b.user_id = $1
		`
		params := []interface{}{userID}
		paramCount := 1

		if catIDStr != "" {
			catID, _ := strconv.Atoi(catIDStr)
			paramCount++
			sql += " AND b.category_id = $" + strconv.Itoa(paramCount)
			params = append(params, catID)
		}

		if tagIDStr != "" {
			tagID, _ := strconv.Atoi(tagIDStr)
			paramCount++
			sql += " AND bt.tag_id = $" + strconv.Itoa(paramCount)
			params = append(params, tagID)
		}

		if isFavStr == "true" {
			sql += " AND b.is_favorite = TRUE"
		}

		if q != "" {
			paramCount++
			sql += " AND (b.title ILIKE $" + strconv.Itoa(paramCount) + " OR b.summary ILIKE $" + strconv.Itoa(paramCount) + " OR b.url ILIKE $" + strconv.Itoa(paramCount) + ")"
			params = append(params, "%"+q+"%")
		}

		sql += " ORDER BY b.created_at DESC"
		rows, err = db.Pool.Query(context.Background(), sql, params...)
	}

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Query execution failed."})
		return
	}
	defer rows.Close()

	for rows.Next() {
		var b Bookmark
		var distVal *float64
		
		if q != "" && semantic == "true" {
			var d float64
			err = rows.Scan(&b.ID, &b.URL, &b.Title, &b.Summary, &b.IsFavorite, &b.CategoryID, &b.CategoryName, &b.CreatedAt, &d)
			distVal = &d
		} else {
			err = rows.Scan(&b.ID, &b.URL, &b.Title, &b.Summary, &b.IsFavorite, &b.CategoryID, &b.CategoryName, &b.CreatedAt)
		}

		if err == nil {
			b.Distance = distVal
			b.Tags = []Tag{}
			b.Assets = []string{}
			bookmarks = append(bookmarks, b)
		}
	}

	// Fetch tags and assets for each bookmark
	for i := range bookmarks {
		// Tags
		tRows, errTag := db.Pool.Query(context.Background(),
			"SELECT t.id, t.name FROM tags t JOIN bookmark_tags bt ON t.id = bt.tag_id WHERE bt.bookmark_id = $1",
			bookmarks[i].ID,
		)
		if errTag == nil {
			for tRows.Next() {
				var t Tag
				if errScan := tRows.Scan(&t.ID, &t.Name); errScan == nil {
					bookmarks[i].Tags = append(bookmarks[i].Tags, t)
				}
			}
			tRows.Close()
		}

		// Assets
		aRows, errAsset := db.Pool.Query(context.Background(),
			"SELECT asset_type FROM encrypted_assets WHERE bookmark_id = $1",
			bookmarks[i].ID,
		)
		if errAsset == nil {
			for aRows.Next() {
				var assetType string
				if errScan := aRows.Scan(&assetType); errScan == nil {
					bookmarks[i].Assets = append(bookmarks[i].Assets, assetType)
				}
			}
			aRows.Close()
		}
	}

	c.JSON(http.StatusOK, bookmarks)
}

func ingestBookmark(c *gin.Context) {
	userID := c.MustGet("userID").(int)
	encryptionKey := c.GetHeader("X-Encryption-Key")

	var req struct {
		URL string `json:"url"`
	}

	if err := c.ShouldBindJSON(&req); err != nil || req.URL == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "URL is required for ingestion."})
		return
	}

	if encryptionKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Missing ephemeral X-Encryption-Key header."})
		return
	}

	parsed, err := url.Parse(req.URL)
	domain := req.URL
	if err == nil {
		domain = parsed.Hostname()
	}

	var bookmark Bookmark
	err = db.Pool.QueryRow(context.Background(),
		`INSERT INTO bookmarks (user_id, url, title, summary) 
		 VALUES ($1, $2, $3, $4) RETURNING id, url, title, summary, created_at`,
		userID, req.URL, domain, "Ingesting page metadata and running local vector indexing...",
	).Scan(&bookmark.ID, &bookmark.URL, &bookmark.Title, &bookmark.Summary, &bookmark.CreatedAt)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create bookmark entry."})
		return
	}

	// Enqueue in Redis list
	jobData := map[string]interface{}{
		"bookmarkId":       bookmark.ID,
		"userId":           userID,
		"url":              req.URL,
		"encryptionKeyHex": encryptionKey,
	}

	jobBytes, _ := json.Marshal(jobData)
	err = db.Pool.QueryRow(context.Background(), "SELECT 1").Scan(new(int)) // Keep pool alive
	
	// LPUSH job onto queue
	redisClient := c.MustGet("redis").(*redis.Client)
	_, err = redisClient.LPush(context.Background(), "linkhub_ingest_queue", string(jobBytes)).Result()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Scraping queue offline."})
		return
	}

	c.JSON(http.StatusAccepted, gin.H{
		"message":  "Ingestion enqueued successfully.",
		"bookmark": bookmark,
	})
}

func toggleFavorite(c *gin.Context) {
	userID := c.MustGet("userID").(int)
	idStr := c.Param("id")
	id, _ := strconv.Atoi(idStr)

	var currentFav bool
	err := db.Pool.QueryRow(context.Background(),
		"SELECT is_favorite FROM bookmarks WHERE id = $1 AND user_id = $2",
		id, userID,
	).Scan(&currentFav)

	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Bookmark not found."})
		return
	}

	var b Bookmark
	err = db.Pool.QueryRow(context.Background(),
		"UPDATE bookmarks SET is_favorite = $1 WHERE id = $2 RETURNING id, is_favorite",
		!currentFav, id,
	).Scan(&b.ID, &b.IsFavorite)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update status."})
		return
	}

	c.JSON(http.StatusOK, b)
}

func deleteBookmark(c *gin.Context) {
	userID := c.MustGet("userID").(int)
	idStr := c.Param("id")
	id, _ := strconv.Atoi(idStr)

	// Fetch assets
	rows, err := db.Pool.Query(context.Background(),
		`SELECT ea.storage_path 
		 FROM encrypted_assets ea
		 JOIN bookmarks b ON ea.bookmark_id = b.id
		 WHERE b.id = $1 AND b.user_id = $2`,
		id, userID,
	)

	if err == nil {
		var storagePaths []string
		for rows.Next() {
			var path string
			if errScan := rows.Scan(&path); errScan == nil {
				storagePaths = append(storagePaths, path)
			}
		}
		rows.Close()

		// Delete from MinIO
		for _, path := range storagePaths {
			_ = s3.DeleteAsset(path)
		}
	}

	// Delete from DB (cascade deletes encryption asset and tag mappings)
	tag, err := db.Pool.Exec(context.Background(),
		"DELETE FROM bookmarks WHERE id = $1 AND user_id = $2",
		id, userID,
	)

	if err != nil || tag.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Bookmark not found."})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Bookmark and files deleted.", "id": id})
}

func getBookmarkAssets(c *gin.Context) {
	userID := c.MustGet("userID").(int)
	idStr := c.Param("id")
	id, _ := strconv.Atoi(idStr)

	// Verify ownership
	var exists int
	err := db.Pool.QueryRow(context.Background(), "SELECT id FROM bookmarks WHERE id = $1 AND user_id = $2", id, userID).Scan(&exists)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Bookmark not found."})
		return
	}

	rows, err := db.Pool.Query(context.Background(),
		"SELECT id, asset_type, initialization_vector, sha256_checksum, created_at FROM encrypted_assets WHERE bookmark_id = $1",
		id,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to query assets."})
		return
	}
	defer rows.Close()

	type Asset struct {
		ID            int       `json:"id"`
		AssetType     string    `json:"asset_type"`
		IV            string    `json:"initialization_vector"`
		Checksum      string    `json:"sha256_checksum"`
		CreatedAt     time.Time `json:"created_at"`
	}

	assets := []Asset{}
	for rows.Next() {
		var a Asset
		if errScan := rows.Scan(&a.ID, &a.AssetType, &a.IV, &a.Checksum, &a.CreatedAt); errScan == nil {
			assets = append(assets, a)
		}
	}

	c.JSON(http.StatusOK, assets)
}

func downloadAssetPayload(c *gin.Context) {
	userID := c.MustGet("userID").(int)
	idStr := c.Param("id")
	id, _ := strconv.Atoi(idStr)
	assetType := c.Param("type")

	var path string
	var iv string
	var checksum string
	err := db.Pool.QueryRow(context.Background(),
		`SELECT ea.storage_path, ea.initialization_vector, ea.sha256_checksum 
		 FROM encrypted_assets ea
		 JOIN bookmarks b ON ea.bookmark_id = b.id
		 WHERE b.id = $1 AND b.user_id = $2 AND ea.asset_type = $3`,
		id, userID, assetType,
	).Scan(&path, &iv, &checksum)

	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Asset not found."})
		return
	}

	encryptedBytes, err := s3.DownloadAsset(path)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "File download from store failed."})
		return
	}

	base64Payload := base64.StdEncoding.EncodeToString(encryptedBytes)

	c.JSON(http.StatusOK, gin.H{
		"encryptedData":        base64Payload,
		"initializationVector": iv,
		"checksum":             checksum,
		"assetType":            assetType,
	})
}

// ==========================================
// HELPERS
// ==========================================

func generateToken(id int, email string) (string, error) {
	claims := Claims{
		ID:    id,
		Email: email,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(7 * 24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(JwtSecret)
}

func getOllamaEmbedding(text, title string) ([]float32, error) {
	urlStr := os.Getenv("OLLAMA_URL")
	if urlStr == "" {
		urlStr = "http://localhost:11434"
	}
	urlStr = strings.TrimSuffix(urlStr, "/")

	embedModel := os.Getenv("OLLAMA_EMBED_MODEL")
	if embedModel == "" {
		embedModel = "all-minilm"
	}

	prompt := title + "\n" + text
	if len(prompt) > 1500 {
		prompt = prompt[:1500]
	}

	payload := map[string]interface{}{
		"model":  embedModel,
		"prompt": prompt,
	}

	bodyBytes, _ := json.Marshal(payload)

	req, err := http.NewRequest("POST", urlStr+"/api/embeddings", bytes.NewBuffer(bodyBytes))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("status error: %d", resp.StatusCode)
	}

	var res EmbedResponse
	if err := json.NewDecoder(resp.Body).Decode(&res); err != nil {
		return nil, err
	}

	return res.Embedding, nil
}
