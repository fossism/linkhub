package main

import (
	"log"

	"linkhub/backend/src/db"
	"linkhub/backend/src/s3"
	"linkhub/backend/src/server"
	"linkhub/backend/src/worker"
)

func main() {
	log.Println("Starting LinkHub Core Services...")

	// 1. Initialize DB and run schema migrations
	if err := db.InitDb(); err != nil {
		log.Fatalf("Critical DB failure: %v\n", err)
	}

	// 2. Initialize MinIO bucket structures
	if err := s3.InitS3(); err != nil {
		log.Fatalf("Critical S3 failure: %v\n", err)
	}

	// 3. Initialize background task queue client
	worker.InitWorker()

	// 4. Spin up concurrent worker loop for ingestion
	go worker.StartWorker()

	// 5. Run API Web Server
	server.StartServer(worker.RedisClient)
}
