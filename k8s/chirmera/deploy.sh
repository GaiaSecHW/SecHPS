#!/bin/bash

set -euo pipefail

NAMESPACE="secflow-ns"
WAIT_TIMEOUT="${WAIT_TIMEOUT:-300s}"
SKIP_DB_INIT_WAIT="${SKIP_DB_INIT_WAIT:-false}"

if [[ -f "./images.env" ]]; then
  # shellcheck disable=SC1091
  source "./images.env"
fi

apply_file() {
  local file="$1"
  echo "$(date): start apply: ${file}"
  kubectl apply -f "${file}"
}

wait_rollout() {
  local resource="$1"
  echo "$(date): waiting rollout: ${resource}"
  kubectl -n "${NAMESPACE}" rollout status "${resource}" --timeout="${WAIT_TIMEOUT}"
}

wait_job() {
  local job_name="$1"
  echo "$(date): waiting job: ${job_name}"
  kubectl -n "${NAMESPACE}" wait --for=condition=complete "job/${job_name}" --timeout="${WAIT_TIMEOUT}"
}

echo "$(date): phase 1 - namespace"
apply_file "./00-chirmera-00-00-namespace.yaml"

echo "$(date): phase 2 - storage and database"
apply_file "./00-chirmera-01-00-postgresql-pvc.yaml"
apply_file "./00-chirmera-01-01-postgresql-secret.yaml"
apply_file "./00-chirmera-01-02-postgresql-deployment.yaml"
apply_file "./00-chirmera-01-03-postgresql-service.yaml"
apply_file "./00-chirmera-02-00-redis-pvc.yaml"
apply_file "./00-chirmera-02-01-redis-deployment.yaml"
apply_file "./00-chirmera-02-02-redis-service.yaml"
wait_rollout "deployment/chirmera-postgresql"
wait_rollout "deployment/chirmera-redis"

echo "$(date): phase 3 - sechps config and persistent volumes"
apply_file "./00-chirmera-03-00-sechps-configmap.yaml"
apply_file "./00-chirmera-03-01-sechps-secret.yaml"
apply_file "./00-chirmera-03-02-sechps-data-pvc.yaml"
apply_file "./00-chirmera-03-03-sechps-uploads-pvc.yaml"
apply_file "./00-chirmera-03-04-sechps-skills-pvc.yaml"
apply_file "./00-chirmera-03-05-sechps-agent-harness-pvc.yaml"

echo "$(date): phase 4 - database init and migrate hooks"
kubectl -n "${NAMESPACE}" delete job chirmera-sechps-db-init --ignore-not-found=true >/dev/null 2>&1 || true
apply_file "./00-chirmera-03-05a-sechps-db-init-job.yaml"
apply_file "./00-chirmera-03-05b-sechps-db-migrate-job.yaml"
if [[ "${SKIP_DB_INIT_WAIT}" != "true" ]]; then
  wait_job "chirmera-sechps-db-init"
else
  echo "$(date): skip waiting db init job"
fi

echo "$(date): phase 5 - sechps service"
apply_file "./00-chirmera-03-06-sechps-deployment.yaml"
apply_file "./00-chirmera-03-07-sechps-service.yaml"
wait_rollout "deployment/chirmera-sechps"

echo "$(date): phase 6 - worker service"
apply_file "./00-chirmera-04-00-worker-configmap.yaml"
apply_file "./00-chirmera-04-01-worker-secret.yaml"
apply_file "./00-chirmera-04-02-worker-deployment.yaml"
apply_file "./00-chirmera-04-03-worker-service.yaml"
wait_rollout "deployment/chirmera-worker"

echo "$(date): phase 7 - ingress"
apply_file "./00-chirmera-05-00-ingress-for-release.yaml"

echo "$(date): deploy done"
