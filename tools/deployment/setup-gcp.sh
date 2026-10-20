#!/usr/bin/env bash
# One-time, repeatable IAM setup. Does not deploy containers or run migrations.
set -euo pipefail
project=uni-rnd
region=europe-west1
account=github-statistics-deployer@uni-rnd.iam.gserviceaccount.com
member="serviceAccount:$account"
principal='principalSet://iam.googleapis.com/projects/1097704636754/locations/global/workloadIdentityPools/github-actions/attribute.repository/AlexVeretrnkin/github-statistics-analog-js'
if ! gcloud iam service-accounts describe "$account" --project="$project" >/dev/null 2>&1; then
  gcloud iam service-accounts create github-statistics-deployer --project="$project" \
    --display-name='GitHub production deployment'
fi
gcloud iam service-accounts add-iam-policy-binding "$account" --project="$project" \
  --member="$principal" --role=roles/iam.workloadIdentityUser --quiet >/dev/null
# Cloud Run Developer can deploy services/jobs but cannot change their IAM policies.
gcloud projects add-iam-policy-binding "$project" --member="$member" \
  --role=roles/run.developer --condition=None --quiet >/dev/null
gcloud projects add-iam-policy-binding "$project" --member="$member" \
  --role=roles/serviceusage.serviceUsageConsumer --condition=None --quiet >/dev/null
gcloud artifacts repositories add-iam-policy-binding cloud-run-source-deploy \
  --project="$project" --location="$region" --member="$member" \
  --role=roles/artifactregistry.writer --quiet >/dev/null
for runtime in github-statistics-app github-ingestion-runtime; do
  gcloud iam service-accounts add-iam-policy-binding "$runtime@$project.iam.gserviceaccount.com" \
    --project="$project" --member="$member" --role=roles/iam.serviceAccountUser --quiet >/dev/null
done
gcloud run services add-iam-policy-binding github-statistics-ingestion \
  --project="$project" --region="$region" --member="$member" --role=roles/run.invoker --quiet >/dev/null
# gcloud impersonation refreshes an access token before minting the smoke-check ID token.
# Scope token creation to the deployer itself.
gcloud iam service-accounts add-iam-policy-binding "$account" --project="$project" \
  --member="$member" --role=roles/iam.serviceAccountTokenCreator --quiet >/dev/null
