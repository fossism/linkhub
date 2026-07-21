# Stage 1: Compile the Go codebase
FROM golang:1.21-bookworm AS builder
WORKDIR /app
COPY go.mod ./
# Download package definitions (it will auto-create go.sum)
RUN go mod download
COPY . .
RUN go build -o main main.go

# Stage 2: Containerize on Chromium-prepared Ubuntu layer
FROM mcr.microsoft.com/playwright:v1.41.2-jammy
WORKDIR /app

# Copy the compiled Go binary and SQL migrations
COPY --from=builder /app/main /app/main
COPY --from=builder /app/schema.sql /app/schema.sql

# Expose backend port
EXPOSE 5000

# Execute server and queue processor
CMD ["/app/main"]
