import { S3Client, PutObjectCommand, GetObjectCommand, CreateBucketCommand, HeadBucketCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

const endpoint = process.env.MINIO_ENDPOINT || 'localhost';
const port = process.env.MINIO_PORT || '9000';
const accessKey = process.env.MINIO_ACCESS_KEY || 'minioadmin';
const secretKey = process.env.MINIO_SECRET_KEY || 'minioadminpassword';
const useSSL = process.env.MINIO_USE_SSL === 'true';

const s3 = new S3Client({
  endpoint: `http${useSSL ? 's' : ''}://${endpoint}:${port}`,
  credentials: {
    accessKeyId: accessKey,
    secretAccessKey: secretKey
  },
  forcePathStyle: true, // Needed for MinIO compatibility
  region: 'us-east-1'
});

const BUCKET_NAME = 'linkhub-assets';

// Helper to check if bucket exists, create if not
export const initS3 = async () => {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET_NAME }));
    console.log(`MinIO bucket "${BUCKET_NAME}" already exists.`);
  } catch (error) {
    // If bucket does not exist, create it
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      try {
        await s3.send(new CreateBucketCommand({ Bucket: BUCKET_NAME }));
        console.log(`Successfully created MinIO bucket "${BUCKET_NAME}".`);
      } catch (createError) {
        console.error('Failed to create MinIO bucket:', createError);
        throw createError;
      }
    } else {
      console.error('Failed checking bucket existence in MinIO:', error);
      throw error;
    }
  }
};

/**
 * Uploads a buffer as a file to MinIO
 * @param {string} key - Unique storage path/key
 * @param {Buffer} buffer - File buffer
 * @param {string} contentType - Mime type of file
 */
export const uploadAsset = async (key, buffer, contentType) => {
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: contentType
  });
  await s3.send(command);
  return key;
};

/**
 * Downloads a file buffer from MinIO
 * @param {string} key - Unique storage path/key
 * @returns {Promise<Buffer>} The file buffer
 */
export const downloadAsset = async (key) => {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key
  });
  
  const response = await s3.send(command);
  const stream = response.Body;
  
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};

/**
 * Deletes a file from MinIO
 * @param {string} key - Unique storage path/key
 */
export const deleteAsset = async (key) => {
  const command = new DeleteObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key
  });
  await s3.send(command);
};

export default {
  initS3,
  uploadAsset,
  downloadAsset,
  deleteAsset
};
