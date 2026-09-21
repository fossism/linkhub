package db

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

var Pool *pgxpool.Pool

// InitDb initializes the PostgreSQL connection pool and executes schema.sql migrations.
func InitDb() error {
	connStr := os.Getenv("DATABASE_URL")
	if connStr == "" {
		connStr = "postgres://linkhub:linkhub_password@localhost:5432/linkhub"
	}

	config, err := pgxpool.ParseConfig(connStr)
	if err != nil {
		return fmt.Errorf("unable to parse DATABASE_URL: %w", err)
	}

	// Max pool configurations
	config.MaxConns = 25
	config.MinConns = 5
	config.MaxConnLifetime = 30 * time.Minute
	config.MaxConnIdleTime = 15 * time.Minute

	// Connect to database
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	Pool, err = pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return fmt.Errorf("unable to connect to database: %w", err)
	}

	// Ping database to confirm connection
	if err := Pool.Ping(ctx); err != nil {
		return fmt.Errorf("database ping failed: %w", err)
	}
	log.Println("Successfully connected to database. Running migrations...")

	// Run migrations
	migrationFile := "schema.sql"
	if _, err := os.Stat(migrationFile); os.IsNotExist(err) {
		// Fallback for different working directories
		migrationFile = "../schema.sql"
	}

	schemaSql, err := os.ReadFile(migrationFile)
	if err != nil {
		return fmt.Errorf("failed to read schema migration file: %w", err)
	}

	_, err = Pool.Exec(context.Background(), string(schemaSql))
	if err != nil {
		return fmt.Errorf("failed to run database schema migrations: %w", err)
	}

	log.Println("Database schema migration completed successfully.")
	return nil
}
