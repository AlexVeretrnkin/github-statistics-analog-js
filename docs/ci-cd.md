# CI/CD and activation checklist

Prepared on 2026-10-19 for `AlexVeretrnkin/github-statistics-analog-js`.

## What is prepared

`.github/workflows/ci-cd.yml` runs on every pull request, pushes to `main`, and manual dispatch.
It runs unit tests, both builds, Drizzle migration checks, snapshot validation, release-script
tests, and the reusable isolated Docker integration workflow. PR jobs have no production credentials.
The Docker check creates a disposable PostgreSQL database, runs the standalone migration command,
and starts ingestion with automatic migrations disabled. Existing local development still migrates automatically.

Deployment runs only for `main`, after both CI jobs pass, when the repository variable
`GCP_DEPLOY_ENABLED` is exactly `true`. It uses the `production` GitHub environment.
Only one production deployment runs at a time. A queued commit superseded on `main` is skipped.

The release builds both images, pushes them to the existing Artifact Registry repository,
and deploys by digest. A Cloud Run Job applies migrations first. New service revisions receive
no production traffic until the public page and authenticated ingestion checkpoint checks pass.
The canonical service URLs are used as token audiences even when checking tagged revisions.
After traffic promotion, the same checks run against production URLs. A failure during or after
promotion attempts to restore each service's previous traffic allocation. Deployments of two services
are not atomic; maintain compatibility between adjacent releases.

Each release uploads `deployment-<commit>` containing `deployment.json`: image digests, previous
traffic, candidate revisions, result, and any rollback errors. Failed migrations stop deployment;
they do not automatically reverse database changes. HTTP smoke checks never publish synthetic data.
The public smoke check currently validates page rendering, not every chart's data semantics.

## Google Cloud setup completed

The repeatable `tools/deployment/setup-gcp.sh` was executed successfully:

- Project: `uni-rnd`; region: `europe-west1`.
- Deployment identity: `github-statistics-deployer@uni-rnd.iam.gserviceaccount.com`.
- Existing main-only Workload Identity Federation provider reused; no service account keys created.
- Cloud Run Developer and Service Usage Consumer roles granted in this project.
- Artifact Registry Writer restricted to `cloud-run-source-deploy`.
- Service Account User restricted to the two existing runtime identities.
- Cloud Run Invoker granted on ingestion for smoke checks.
- Token creation granted only for the deployer's own identity (gcloud requires an access-token
  refresh before minting the smoke-check ID token).

Existing application images, traffic, secret values, and database data were not changed.
The migration job itself will be created by the first enabled release. It currently reuses the
existing ingestion runtime identity and database secret version `1`, matching the deployed service.
If the database credential is rotated, update this reference in `tools/deployment/deploy.mjs`.
The ingestion runtime still has its existing database privileges; separate migration-only database
credentials can be introduced later. Production ingestion sets `RESEARCH_DATABASE_MIGRATIONS=external`
so neither startup nor request handlers run migrations; the explicit job always runs them.

## What to do when back at the laptop

1. **Provide authenticated GitHub access.** Connect GitHub to Codex or install/authenticate GitHub CLI
   with `gh auth login`. No Google Cloud key or token needs to be copied into GitHub.
2. **Review and publish the CI/CD changes through a pull request.** There were already unrelated
   staged and unstaged research/UI changes in this checkout. Keep those separate when preparing
   the CI/CD commit. The new orchestration tests and migration files must be included.
   Keep `GCP_DEPLOY_ENABLED` unset while landing and checking the workflow.
3. **Create a GitHub environment named `production`.** Restrict its deployment branches to `main`.
   Leave required reviewers off for the requested fully automatic releases. If reviewers are
   enabled temporarily for the first release, each deployment waits for their approval.
4. **Protect `main` after the first CI run registers the check names.** Require pull requests and
   the successful `Tests and builds` and reusable container integration/bootstrap checks displayed
   by GitHub. Require branches to be up to date, and block force pushes and deletion. Do not make
   the production deployment job a required PR check because it is intentionally skipped on PRs.
5. **Check Neon recovery coverage before the first schema-changing release.** Confirm the desired
   restore window/backups in the Neon console. Future migrations must be backward compatible:
   add first, migrate callers, remove old columns in a later release. This work did not inspect
   or change the Neon account's recovery configuration.
6. **Enable and observe the first deployment.** In repository Settings → Secrets and variables →
   Actions → Variables, add `GCP_DEPLOY_ENABLED=true`. Manually run `CI and deployment` on `main`.
   Download the deployment report, check the dashboard and collection workflows, and confirm the
   deployment succeeds. Subsequent pushes to `main` deploy automatically.
7. **Enable GitHub Actions failure notifications** in your GitHub notification settings. Custom
   email/Slack alerts and Cloud Monitoring alerts are not configured by this change.

Useful pages:
- Actions: https://github.com/AlexVeretrnkin/github-statistics-analog-js/actions
- Repository variables: https://github.com/AlexVeretrnkin/github-statistics-analog-js/settings/variables/actions
- Environments: https://github.com/AlexVeretrnkin/github-statistics-analog-js/settings/environments
- Branch rules: https://github.com/AlexVeretrnkin/github-statistics-analog-js/settings/branches

## Manual rollback

Set `GCP_DEPLOY_ENABLED=false` to prevent new releases (this does not cancel an already-running job).
Read `previousTraffic` for each service from the deployment artifact and substitute that exact
allocation below. Do not use `--to-latest`, because the latest revision can be the failed one.

```sh
gcloud run services update-traffic github-statistics-analog-js \
  --project=uni-rnd --region=europe-west1 --to-revisions='PREVIOUS_WEB_REVISION=100'
gcloud run services update-traffic github-statistics-ingestion \
  --project=uni-rnd --region=europe-west1 --to-revisions='PREVIOUS_INGESTION_REVISION=100'
```

Rollback changes application traffic only. If a migration is incompatible with old code, investigate
and repair the schema before routing traffic to that code. Preserve old revisions and images needed
for recovery. Interrupting a GitHub runner during promotion may prevent automated rollback; use the
saved traffic allocations manually in that case.

## Validation

Passed locally: application tests (18 existing tests plus 2 migration-mode tests), both native builds,
Drizzle migration checks, 11 snapshot checks, all 6 deployment-script tests, and actionlint workflow
validation. Three existing database integration specs skip without their opt-in database environment;
the isolated Docker workflow provides the release gate for database/container integration.

The full Docker integration run was stopped during web compilation after prolonged local Docker
resource contention; it is **not verified**. A smaller check using the successfully built ingestion/migration images also timed out waiting
for dependencies. Neither container integration result is claimed as passing. Temporary test
containers and the disposable database volume were cleaned up.
The first attempt also encountered a waiting Docker Desktop credential helper; the retry used an
isolated anonymous Docker configuration. Run the GitHub container integration check successfully
before activating deployment. The local Google user lacks deployer impersonation permission, so
live deployer authentication must also be verified through the first GitHub WIF run. No additional
human impersonation permission was granted.

GitHub-hosted execution and real production rollout remain to be verified after publication and activation. The deployment orchestration
tests use a fake gcloud executable and a temporary HTTP server to exercise successful release,
migration failure, candidate failure, and rollback after production checks fail, without cloud changes.
