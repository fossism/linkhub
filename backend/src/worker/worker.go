package worker

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"

	"linkhub/backend/src/crypto"
	"linkhub/backend/src/db"
	"linkhub/backend/src/s3"

	"github.com/chromedp/cdproto/page"
	"github.com/chromedp/chromedp"
	"github.com/go-redis/go-redis/v9"
	"github.com/go-shiori/go-readability"
)

type IngestJob struct {
	BookmarkID       int    `json:"bookmarkId"`
	UserID           int    `json:"userId"`
	URL              string `json:"url"`
	EncryptionKeyHex string `json:"encryptionKeyHex"`
}

type EmbedResponse struct {
	Embedding []float32 `json:"embedding"`
}

type GenerateResponse struct {
	Response string `json:"response"`
}

var RedisClient *redis.Client

// InitWorker establishes connection to Redis
func InitWorker() {
	redisAddr := os.Getenv("REDIS_URL")
	if redisAddr == "" {
		redisAddr = "localhost:6379"
	}
	// Parse redis:// proto if present
	if strings.HasPrefix(redisAddr, "redis://") {
		redisAddr = strings.TrimPrefix(redisAddr, "redis://")
	}

	RedisClient = redis.NewClient(&redis.Options{
		Addr: redisAddr,
	})
	log.Printf("Connected to Redis at %s for Ingestion Worker.\n", redisAddr)
}

// StartWorker spins up the background queue loop
func StartWorker() {
	ctx := context.Background()
	log.Println("Ingestion Worker loop started.")

	for {
		// BRPOP blocks until a job is available in the queue
		res, err := RedisClient.BRPop(ctx, 0, "linkhub_ingest_queue").Result()
		if err != nil {
			log.Printf("Redis queue BRPOP error: %v\n", err)
			time.Sleep(2 * time.Second)
			continue
		}

		if len(res) < 2 {
			continue
		}

		payload := res[1]
		log.Printf("Processing new ingestion job from queue: %s\n", payload)

		var job IngestJob
		if err := json.Unmarshal([]byte(payload), &job); err != nil {
			log.Printf("Failed to deserialize job payload: %v\n", err)
			continue
		}

		go func(j IngestJob) {
			if err := ProcessJob(j); err != nil {
				log.Printf("Job failed for Bookmark ID %d: %v\n", j.BookmarkID, err)
			} else {
				log.Printf("Job succeeded for Bookmark ID %d\n", j.BookmarkID)
			}
		}(job)
	}
}

// ProcessJob performs scraping, AI extraction, and encrypted uploads
func ProcessJob(job IngestJob) error {
	log.Printf("Scraping URL: %s\n", job.URL)

	// Set up Chromedp
	opts := append(chromedp.DefaultExecAllocatorOptions[:],
		chromedp.NoSandbox,
		chromedp.DisableGPU,
		chromedp.Flag("disable-setuid-sandbox", true),
		chromedp.Flag("disable-dev-shm-usage", true),
		chromedp.Flag("disable-web-security", true),
	)
	
	allocCtx, allocCancel := chromedp.NewExecAllocator(context.Background(), opts...)
	defer allocCancel()

	ctx, cancel := chromedp.NewContext(allocCtx)
	defer cancel()

	ctx, cancel = context.WithTimeout(ctx, 45*time.Second)
	defer cancel()

	var title string
	var htmlDump string
	var screenshotBuf []byte
	var pdfBuf []byte

	// Execute Chromedp browser actions
	err := chromedp.Run(ctx,
		chromedp.Navigate(job.URL),
		chromedp.Sleep(1500*time.Millisecond),
		chromedp.Title(&title),
		chromedp.OuterHTML("html", &htmlDump),
		chromedp.CaptureScreenshot(&screenshotBuf),
		chromedp.ActionFunc(func(ctx context.Context) error {
			var err error
			// PDF generation only works in headless mode
			pdfBuf, _, err = page.PrintToPDF().WithPrintBackground(true).Do(ctx)
			if err != nil {
				log.Printf("PDF printing skipped or failed: %v\n", err)
			}
			return nil
		}),
	)

	if err != nil {
		fallbackTitle := job.URL
		if u, errParse := url.Parse(job.URL); errParse == nil {
			fallbackTitle = u.Hostname()
		}
		
		// Mark bookmark as failed in DB
		_, dbErr := db.Pool.Exec(context.Background(),
			"UPDATE bookmarks SET title = $1, summary = $2 WHERE id = $3",
			fallbackTitle, fmt.Sprintf("Failed to scrape page. Error: %v", err), job.BookmarkID,
		)
		if dbErr != nil {
			log.Printf("DB error saving failure state: %v\n", dbErr)
		}
		return fmt.Errorf("chromedp run failed: %w", err)
	}

	if title == "" {
		title = "Untitled Bookmark"
	}

	// Parse main text content via go-readability
	parsedUrl, _ := url.Parse(job.URL)
	article, err := readability.FromReader(strings.NewReader(htmlDump), parsedUrl)
	readableText := ""
	if err == nil {
		readableText = article.TextContent
	} else {
		readableText = htmlDump
	}

	// Get AI embeddings
	embedding, err := getOllamaEmbedding(readableText, title)
	if err != nil {
		log.Printf("Ollama embedding extraction failed: %v. Using dummy vector.", err)
		embedding = make([]float32, 384) // 384 dimensions
	}

	// Convert embedding to JSON format for pgvector
	embeddingJson, err := json.Marshal(embedding)
	if err != nil {
		embeddingJson = []byte("[]")
	}

	// Semantic matching for folder assignment
	var finalCategoryId *int
	var matchedCatName string
	var distance float64

	// Query closest category by cosine similarity
	err = db.Pool.QueryRow(context.Background(),
		`SELECT id, name, (centroid_vector <=> $1::vector) AS distance 
		 FROM categories 
		 WHERE user_id = $2 AND centroid_vector IS NOT NULL 
		 ORDER BY distance ASC LIMIT 1`,
		string(embeddingJson), job.UserID,
	).Scan(&finalCategoryId, &matchedCatName, &distance)

	if err == nil && distance < 0.25 {
		log.Printf("Auto-assigned to existing folder: \"%s\" (Distance: %f)\n", matchedCatName, distance)
	} else {
		// Category prediction fallback
		predCategoryName := predictCategoryName(readableText, title, job.URL)
		
		// Check if folder exists
		var existingId int
		err = db.Pool.QueryRow(context.Background(),
			"SELECT id FROM categories WHERE user_id = $1 AND LOWER(name) = LOWER($2)",
			job.UserID, predCategoryName,
		).Scan(&existingId)

		if err == nil {
			finalCategoryId = &existingId
			log.Printf("Matched predicted category with folder: \"%s\"\n", predCategoryName)
		} else {
			// Create new category
			var newId int
			err = db.Pool.QueryRow(context.Background(),
				"INSERT INTO categories (user_id, name, description) VALUES ($1, $2, $3) RETURNING id",
				job.UserID, predCategoryName, fmt.Sprintf("Auto-generated folder for %s-related content.", predCategoryName),
			).Scan(&newId)
			if err == nil {
				finalCategoryId = &newId
				log.Printf("Created new folder: \"%s\"\n", predCategoryName)
			}
		}
	}

	// AI summary & tags
	summary := generateSummary(readableText, title)
	tags := generateTags(readableText, title)

	// Save main Bookmark metadata
	_, err = db.Pool.Exec(context.Background(),
		`UPDATE bookmarks 
		 SET title = $1, summary = $2, category_id = $3, raw_text_vector = $4::vector 
		 WHERE id = $5`,
		title, summary, finalCategoryId, string(embeddingJson), job.BookmarkID,
	)
	if err != nil {
		return fmt.Errorf("failed to save bookmark metadata: %w", err)
	}

	// Insert and associate tags
	for _, tagName := range tags {
		var tagId int
		err = db.Pool.QueryRow(context.Background(),
			`INSERT INTO tags (user_id, name) VALUES ($1, $2) 
			 ON CONFLICT (user_id, name) DO UPDATE SET name = EXCLUDED.name 
			 RETURNING id`,
			job.UserID, tagName,
		).Scan(&tagId)
		if err == nil {
			_, _ = db.Pool.Exec(context.Background(),
				"INSERT INTO bookmark_tags (bookmark_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
				job.BookmarkID, tagId,
			)
		}
	}

	// Encrypt and upload assets
	if job.EncryptionKeyHex != "" {
		assets := []struct {
			Type        string
			Payload     []byte
			ContentType string
		}{
			{Type: "html_dump", Payload: []byte(htmlDump), ContentType: "text/html"},
			{Type: "screenshot", Payload: screenshotBuf, ContentType: "image/png"},
		}

		if len(pdfBuf) > 0 {
			assets = append(assets, struct {
				Type        string
				Payload     []byte
				ContentType string
			}{Type: "pdf", Payload: pdfBuf, ContentType: "application/pdf"})
		}

		for _, asset := range assets {
			encryptedBytes, ivHex, err := crypto.EncryptBuffer(asset.Payload, job.EncryptionKeyHex)
			if err != nil {
				log.Printf("Encryption failed for asset %s: %v\n", asset.Type, err)
				continue
			}

			hasher := sha256.New()
			hasher.Write(asset.Payload)
			checksum := hex.EncodeToString(hasher.Sum(nil))

			storagePath := fmt.Sprintf("%d/%d/%s.enc", job.UserID, job.BookmarkID, asset.Type)

			_, err = s3.UploadAsset(storagePath, encryptedBytes, asset.ContentType)
			if err != nil {
				log.Printf("S3 upload failed for asset %s: %v\n", asset.Type, err)
				continue
			}

			_, err = db.Pool.Exec(context.Background(),
				`INSERT INTO encrypted_assets (bookmark_id, asset_type, storage_path, initialization_vector, sha256_checksum)
				 VALUES ($1, $2, $3, $4, $5)`,
				job.BookmarkID, asset.Type, storagePath, ivHex, checksum,
			)
			if err != nil {
				log.Printf("Failed to log asset meta in DB: %v\n", err)
			}
		}
	}

	return nil
}

// predictCategoryName queries Ollama or falls back to standard keyword mapping
func predictCategoryName(text, title, urlStr string) string {
	ollamaUrl := getOllamaUrl()
	ollamaModel := getOllamaModel()

	prompt := fmt.Sprintf(`You are a categorization assistant. Given the title, URL, and content snippet of a web page, predict a single, broad category name (e.g., "Technology", "Cooking", "Finance", "Science", "Education", "Lifestyle", "Design", "News").
Respond ONLY with the category name (1-2 words). Do not include any punctuation, quotes, or extra text.
Title: %s
URL: %s
Snippet: %s

Category:`, title, urlStr, truncateString(text, 1000))

	category, err := queryOllama(ollamaUrl, ollamaModel, prompt)
	if err == nil && category != "" {
		cleaned := regexp.MustCompile(`[^a-zA-Z0-9\s/]`).ReplaceAllString(category, "")
		cleaned = strings.TrimSpace(cleaned)
		if len(cleaned) > 2 && len(cleaned) < 30 {
			return cleaned
		}
	}

	// Fallback rule-based matching
	lowerText := strings.ToLower(title + " " + urlStr + " " + truncateString(text, 1000))
	if strings.Contains(lowerText, "github") || strings.Contains(lowerText, "code") || strings.Contains(lowerText, "npm") || strings.Contains(lowerText, "developer") || strings.Contains(lowerText, "react") || strings.Contains(lowerText, "api") {
		return "Development"
	}
	if strings.Contains(lowerText, "recipe") || strings.Contains(lowerText, "cook") || strings.Contains(lowerText, "food") || strings.Contains(lowerText, "kitchen") || strings.Contains(lowerText, "bake") {
		return "Cooking"
	}
	if strings.Contains(lowerText, "stock") || strings.Contains(lowerText, "crypto") || strings.Contains(lowerText, "finance") || strings.Contains(lowerText, "investing") || strings.Contains(lowerText, "money") {
		return "Finance"
	}
	if strings.Contains(lowerText, "design") || strings.Contains(lowerText, "css") || strings.Contains(lowerText, "ui/ux") || strings.Contains(lowerText, "vector") || strings.Contains(lowerText, "color") {
		return "Design"
	}
	if strings.Contains(lowerText, "science") || strings.Contains(lowerText, "physics") || strings.Contains(lowerText, "research") || strings.Contains(lowerText, "nature") || strings.Contains(lowerText, "space") {
		return "Science"
	}

	return "General"
}

// generateSummary summarizes text via Ollama or parses first sentences
func generateSummary(text, title string) string {
	ollamaUrl := getOllamaUrl()
	ollamaModel := getOllamaModel()

	prompt := fmt.Sprintf(`You are a summarization assistant. Read this web page text and write a clean, 2-sentence executive summary.
Title: %s
Content snippet: %s

Summary:`, title, truncateString(text, 3000))

	summary, err := queryOllama(ollamaUrl, ollamaModel, prompt)
	if err == nil && summary != "" {
		return strings.TrimSpace(summary)
	}

	// Fallback local NLP sentence segmenter
	cleanSnippet := regexp.MustCompile(`\s+`).ReplaceAllString(text, " ")
	cleanSnippet = strings.TrimSpace(cleanSnippet)
	sentences := regexp.MustCompile(`(?<=[.!?])\s+`).Split(cleanSnippet, -1)
	
	var summarySentences []string
	summaryLength := 0
	for _, sentence := range sentences {
		if len(sentence) > 15 {
			summarySentences = append(summarySentences, sentence)
			summaryLength += len(sentence)
			if len(summarySentences) >= 2 || summaryLength > 200 {
				break
			}
		}
	}

	if len(summarySentences) > 0 {
		return strings.Join(summarySentences, " ")
	}

	return fmt.Sprintf("Archived link to %s.", title)
}

// generateTags extracts tags via Ollama or word frequency
func generateTags(text, title string) []string {
	ollamaUrl := getOllamaUrl()
	ollamaModel := getOllamaModel()

	prompt := fmt.Sprintf(`You are a taxonomy expert. Output up to 5 precise keywords or tags for this web page.
Respond ONLY with a comma-separated list of lowercase tags. Example: react, javascript, frontend, hooks.
Title: %s
Content snippet: %s

Tags:`, title, truncateString(text, 1500))

	tagsRes, err := queryOllama(ollamaUrl, ollamaModel, prompt)
	if err == nil && tagsRes != "" {
		var tags []string
		for _, part := range strings.Split(tagsRes, ",") {
			cleaned := regexp.MustCompile(`[^a-zA-Z0-9-]`).ReplaceAllString(part, "")
			cleaned = strings.TrimSpace(strings.ToLower(cleaned))
			if len(cleaned) > 1 && len(cleaned) < 20 {
				tags = append(tags, cleaned)
			}
		}
		if len(tags) > 0 {
			return tags
		}
	}

	// Fallback word frequency counter
	blacklist := map[string]bool{
		"the": true, "and": true, "for": true, "with": true, "this": true, "that": true,
		"your": true, "from": true, "have": true, "were": true, "about": true, "should": true,
		"would": true, "could": true, "their": true, "there": true, "these": true, "those": true,
		"home": true, "page": true, "site": true, "website": true, "login": true, "signup": true,
	}

	cleanStr := regexp.MustCompile(`[^a-z0-9\s-]`).ReplaceAllString(strings.ToLower(title+" "+truncateString(text, 1000)), "")
	words := strings.Fields(cleanStr)

	freq := make(map[string]int)
	for _, word := range words {
		if len(word) > 3 && !blacklist[word] {
			freq[word]++
		}
	}

	// Grab top 4
	var tags []string
	for i := 0; i < 4; i++ {
		bestWord := ""
		bestCount := -1
		for w, c := range freq {
			if c > bestCount {
				bestCount = c
				bestWord = w
			}
		}
		if bestWord != "" {
			tags = append(tags, bestWord)
			delete(freq, bestWord)
		}
	}

	if len(tags) == 0 {
		return []string{"web", "bookmark"}
	}
	return tags
}

// getOllamaEmbedding calls the Ollama embeddings API
func getOllamaEmbedding(text, title string) ([]float32, error) {
	ollamaUrl := getOllamaUrl()
	embedModel := os.Getenv("OLLAMA_EMBED_MODEL")
	if embedModel == "" {
		embedModel = "all-minilm"
	}

	prompt := title + "\n" + truncateString(text, 1500)

	payload := map[string]interface{}{
		"model":  embedModel,
		"prompt": prompt,
	}

	bodyBytes, _ := json.Marshal(payload)

	req, err := http.NewRequest("POST", ollamaUrl+"/api/embeddings", bytes.NewBuffer(bodyBytes))
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

// Helper to check Ollama status
func queryOllama(ollamaUrl, model, prompt string) (string, error) {
	payload := map[string]interface{}{
		"model":  model,
		"prompt": prompt,
		"stream": false,
	}

	bodyBytes, _ := json.Marshal(payload)

	req, err := http.NewRequest("POST", ollamaUrl+"/api/generate", bytes.NewBuffer(bodyBytes))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("status error: %d", resp.StatusCode)
	}

	var res GenerateResponse
	if err := json.NewDecoder(resp.Body).Decode(&res); err != nil {
		return "", err
	}

	return res.Response, nil
}

func getOllamaUrl() string {
	urlStr := os.Getenv("OLLAMA_URL")
	if urlStr == "" {
		urlStr = "http://localhost:11434"
	}
	return strings.TrimSuffix(urlStr, "/")
}

func getOllamaModel() string {
	m := os.Getenv("OLLAMA_MODEL")
	if m == "" {
		m = "llama3"
	}
	return m
}

func truncateString(s string, max int) string {
	if len(s) > max {
		return s[:max]
	}
	return s
}
