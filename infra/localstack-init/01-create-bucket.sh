#!/usr/bin/env bash
# Runs inside the LocalStack container on every startup.
# Creates the CV bucket if it doesn't exist (idempotent).

set -euo pipefail

BUCKET="${S3_BUCKET:-ai-job-hunter-cvs}"

echo "[init] ensuring S3 bucket: ${BUCKET}"
awslocal s3api create-bucket --bucket "${BUCKET}" 2>/dev/null || true
awslocal s3api put-bucket-cors --bucket "${BUCKET}" --cors-configuration '{
  "CORSRules": [{
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "PUT", "POST", "DELETE", "HEAD"],
    "AllowedOrigins": ["http://localhost:5173"],
    "ExposeHeaders": ["ETag"]
  }]
}'
echo "[init] bucket ready"
