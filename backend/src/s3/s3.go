package s3

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"strconv"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

var (
	Client     *minio.Client
	BucketName = "linkhub-assets"
)

// InitS3 connects to MinIO and ensures the target bucket exists.
func InitS3() error {
	endpoint := os.Getenv("MINIO_ENDPOINT")
	if endpoint == "" {
		endpoint = "localhost"
	}
	port := os.Getenv("MINIO_PORT")
	if port == "" {
		port = "9000"
	}
	accessKey := os.Getenv("MINIO_ACCESS_KEY")
	if accessKey == "" {
		accessKey = "minioadmin"
	}
	secretKey := os.Getenv("MINIO_SECRET_KEY")
	if secretKey == "" {
		secretKey = "minioadminpassword"
	}
	useSSLStr := os.Getenv("MINIO_USE_SSL")
	useSSL, _ := strconv.ParseBool(useSSLStr)

	fullEndpoint := fmt.Sprintf("%s:%s", endpoint, port)

	var err error
	Client, err = minio.New(fullEndpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: useSSL,
	})
	if err != nil {
		return fmt.Errorf("failed to initialize MinIO client: %w", err)
	}

	ctx := context.Background()
	exists, err := Client.BucketExists(ctx, BucketName)
	if err != nil {
		return fmt.Errorf("failed to check if bucket exists: %w", err)
	}

	if !exists {
		err = Client.MakeBucket(ctx, BucketName, minio.MakeBucketOptions{Region: "us-east-1"})
		if err != nil {
			return fmt.Errorf("failed to create bucket: %w", err)
		}
		log.Printf("Successfully created MinIO bucket \"%s\".\n", BucketName)
	} else {
		log.Printf("MinIO bucket \"%s\" already exists.\n", BucketName)
	}

	return nil
}

// UploadAsset uploads a byte slice to MinIO.
func UploadAsset(key string, data []byte, contentType string) (string, error) {
	ctx := context.Background()
	reader := bytes.NewReader(data)
	_, err := Client.PutObject(ctx, BucketName, key, reader, int64(len(data)), minio.PutObjectOptions{
		ContentType: contentType,
	})
	if err != nil {
		return "", fmt.Errorf("failed to upload object: %w", err)
	}
	return key, nil
}

// DownloadAsset downloads an object from MinIO and returns it as a byte slice.
func DownloadAsset(key string) ([]byte, error) {
	ctx := context.Background()
	object, err := Client.GetObject(ctx, BucketName, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to download object: %w", err)
	}
	defer object.Close()

	buf := new(bytes.Buffer)
	if _, err := io.Copy(buf, object); err != nil {
		return nil, fmt.Errorf("failed to read object payload: %w", err)
	}

	return buf.Bytes(), nil
}

// DeleteAsset deletes an object from MinIO.
func DeleteAsset(key string) error {
	ctx := context.Background()
	err := Client.RemoveObject(ctx, BucketName, key, minio.RemoveObjectOptions{})
	if err != nil {
		return fmt.Errorf("failed to delete object: %w", err)
	}
	return nil
}
