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

## Activation and recovery checklist

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

## Validation and first release

The protected PR and merged commit passed all required GitHub-hosted checks on 2026-10-20,
including native builds, unit tests, Drizzle checks, deployment/rollback simulations, and the full
isolated Docker integration test. This resolves the earlier local Docker resource-contention
limitation. Workload Identity Federation, registry publication, and the production migration job
were also verified in the first release attempt.

That attempt stopped before traffic promotion because `/healthz` received a Google Frontend 404;
the authenticated checkpoint route on the same candidate returned 200. Probes now use `/health`.
The old `/healthz` handler remains as a local compatibility alias, but is not used for deployment.

The `production` environment is restricted to `main`, branch protection requires both CI checks,
and `GCP_DEPLOY_ENABLED` is enabled. Neon backups were confirmed by the owner. The deployment
identity has no human impersonation grant; GitHub uses the configured federation provider.

For the current release result, consult the latest [CI and deployment run](https://github.com/AlexVeretrnkin/github-statistics-analog-js/actions/workflows/ci-cd.yml)
and its deployment artifact. A successful pipeline includes candidate and post-promotion smoke
checks; a failed pipeline must be investigated before claiming a release succeeded.
