# Add CodeSwarm Prefix To Kubernetes Pod Names Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the Kubernetes Scheduler and Worker Deployments so generated Pod names use the `codeswarm-` prefix while preserving existing Service routing.

**Architecture:** Kubernetes Pod names are derived from Deployment names, so only the Scheduler and Worker Deployment metadata names should change. Keep existing labels/selectors (`app: scheduler`, `app: worker`) and Service names unchanged to avoid breaking `SCHEDULER_URL=http://scheduler:8080`, Ingress, ServiceMonitor, and intra-cluster routing. Update HPA and operational docs to reference the new Deployment names.

**Tech Stack:** Kubernetes manifests, YAML, kubectl, Markdown docs.

---

## File Structure

- Modify: `k8s/scheduler-deployment.yaml`
  - Change `metadata.name` from `scheduler` to `codeswarm-scheduler`.
  - Do not change selector labels or Pod template labels.
- Modify: `k8s/worker-deployment.yaml`
  - Change `metadata.name` from `worker` to `codeswarm-worker`.
  - Do not change selector labels or Pod template labels.
- Modify: `k8s/worker-hpa.yaml`
  - Change `spec.scaleTargetRef.name` from `worker` to `codeswarm-worker`.
- Modify: `k8s/README.md`
  - Update kubectl commands that reference `deploy/scheduler`, `deployment/scheduler`, `deploy/worker`, or `deployment/worker` to use `codeswarm-scheduler` / `codeswarm-worker`.
  - Keep Service checks using `http://scheduler:8080` unchanged.

---

## Chunk 1: Rename Deployments And HPA Target

### Task 1: Rename Deployment resources

**Files:**
- Modify: `k8s/scheduler-deployment.yaml:3`
- Modify: `k8s/worker-deployment.yaml:3`

- [ ] **Step 1: Update Scheduler Deployment name**

Change:

```yaml
metadata:
  name: scheduler
```

To:

```yaml
metadata:
  name: codeswarm-scheduler
```

- [ ] **Step 2: Update Worker Deployment name**

Change:

```yaml
metadata:
  name: worker
```

To:

```yaml
metadata:
  name: codeswarm-worker
```

- [ ] **Step 3: Verify labels/selectors were not renamed**

Run:

```bash
git diff -- k8s/scheduler-deployment.yaml k8s/worker-deployment.yaml
```

Expected:

```diff
-  name: scheduler
+  name: codeswarm-scheduler
...
-  name: worker
+  name: codeswarm-worker
```

No changes should appear for:

```yaml
matchLabels:
  app: scheduler
...
labels:
  app: scheduler
```

or:

```yaml
matchLabels:
  app: worker
...
labels:
  app: worker
```

### Task 2: Update Worker HPA target

**Files:**
- Modify: `k8s/worker-hpa.yaml:9`

- [ ] **Step 1: Update HPA scale target name**

Change:

```yaml
scaleTargetRef:
  apiVersion: apps/v1
  kind: Deployment
  name: worker
```

To:

```yaml
scaleTargetRef:
  apiVersion: apps/v1
  kind: Deployment
  name: codeswarm-worker
```

- [ ] **Step 2: Verify HPA points to new Deployment name**

Run:

```bash
git diff -- k8s/worker-hpa.yaml
```

Expected:

```diff
-    name: worker
+    name: codeswarm-worker
```

### Task 3: Validate Kubernetes manifests locally

**Files:**
- No file changes.

- [ ] **Step 1: Run kubectl dry-run validation**

Run:

```bash
kubectl apply --dry-run=client -f k8s/
```

Expected: every manifest reports `created (dry run)` or `configured (dry run)` with no YAML/schema errors.

- [ ] **Step 2: Confirm expected resource names appear in dry-run output**

Expected output should include resources similar to:

```text
deployment.apps/codeswarm-scheduler ... (dry run)
deployment.apps/codeswarm-worker ... (dry run)
horizontalpodautoscaler.autoscaling/worker-hpa ... (dry run)
```

---

## Chunk 2: Update Kubernetes Operations Documentation

### Task 4: Update README deployment references

**Files:**
- Modify: `k8s/README.md`

- [ ] **Step 1: Replace Scheduler Deployment command references**

Replace command references:

```text
deploy/scheduler
deployment/scheduler
```

With:

```text
deploy/codeswarm-scheduler
deployment/codeswarm-scheduler
```

- [ ] **Step 2: Replace Worker Deployment command references**

Replace command references:

```text
deploy/worker
deployment/worker
```

With:

```text
deploy/codeswarm-worker
deployment/codeswarm-worker
```

- [ ] **Step 3: Keep Kubernetes Service references unchanged**

Do not change commands or URLs that intentionally refer to the Scheduler Service:

```bash
http://scheduler:8080/health
kubectl get endpoints -n secflow-ns scheduler codeswarm-postgres codeswarm-redis -o wide
```

Reason: Service name remains `scheduler` for compatibility with Worker `SCHEDULER_URL` and Ingress backend.

- [ ] **Step 4: Verify old Deployment names are gone from README command references**

Run:

```bash
grep -nE 'deploy/(scheduler|worker)|deployment/(scheduler|worker)' k8s/README.md || true
```

Expected: no output.

- [ ] **Step 5: Verify new Deployment names appear**

Run:

```bash
grep -nE 'codeswarm-scheduler|codeswarm-worker' k8s/README.md
```

Expected: log, rollout, scale, describe, and set-image command examples reference the new Deployment names.

---

## Chunk 3: Runtime Verification

### Task 5: Apply and verify renamed Pods

**Files:**
- No additional file changes.

- [ ] **Step 1: Apply updated manifests**

Run:

```bash
kubectl apply -f k8s/scheduler-deployment.yaml
kubectl apply -f k8s/worker-deployment.yaml
kubectl apply -f k8s/worker-hpa.yaml
```

Expected:

```text
deployment.apps/codeswarm-scheduler created
 deployment.apps/codeswarm-worker created
horizontalpodautoscaler.autoscaling/worker-hpa configured
```

If existing old Deployments still exist, Kubernetes may temporarily run both old and new Deployments until the old ones are explicitly deleted.

- [ ] **Step 2: Wait for new Deployments to become available**

Run:

```bash
kubectl rollout status deployment/codeswarm-scheduler -n secflow-ns
kubectl rollout status deployment/codeswarm-worker -n secflow-ns
```

Expected:

```text
deployment "codeswarm-scheduler" successfully rolled out
deployment "codeswarm-worker" successfully rolled out
```

- [ ] **Step 3: Verify Pod names have the prefix**

Run:

```bash
kubectl get pods -n secflow-ns -o wide | grep -E 'codeswarm-(scheduler|worker)'
```

Expected: Pod names start with:

```text
codeswarm-scheduler-
codeswarm-worker-
```

- [ ] **Step 4: Verify Services still route to new Pods**

Run:

```bash
kubectl get endpoints -n secflow-ns scheduler codeswarm-postgres codeswarm-redis -o wide
```

Expected: `scheduler` endpoint points to the new `codeswarm-scheduler` Pod IP via unchanged `app: scheduler` labels.

- [ ] **Step 5: Verify Scheduler health through Service**

Run:

```bash
kubectl exec -n secflow-ns deploy/codeswarm-scheduler -- sh -c \
  'wget -qO- http://scheduler:8080/health || curl -sf http://scheduler:8080/health'
```

Expected: JSON health response similar to:

```json
{"service":"codeswarm-scheduler","status":"running","port":8080}
```

- [ ] **Step 6: Verify Worker heartbeat/logs**

Run:

```bash
kubectl logs -n secflow-ns deploy/codeswarm-worker --tail=80
```

Expected: logs include heartbeat success messages or normal worker startup logs, with no repeated Scheduler connection errors.

- [ ] **Step 7: Delete old Deployments after new ones are healthy**

Run only after Steps 2-6 pass:

```bash
kubectl delete deployment/scheduler deployment/worker -n secflow-ns --ignore-not-found
```

Expected: old Deployments deleted or reported not found. Services remain intact because Services were not deleted.

- [ ] **Step 8: Final status check**

Run:

```bash
kubectl get deploy,pods,hpa,svc -n secflow-ns -o wide
```

Expected:

- Deployments include `codeswarm-scheduler` and `codeswarm-worker`.
- No Deployments named exactly `scheduler` or `worker` remain.
- Pods include `codeswarm-scheduler-*` and `codeswarm-worker-*`.
- HPA `worker-hpa` targets `Deployment/codeswarm-worker`.
- Service `scheduler` still exists.

---

## Commit

- [ ] **Step 1: Review full diff**

Run:

```bash
git diff -- k8s/scheduler-deployment.yaml k8s/worker-deployment.yaml k8s/worker-hpa.yaml k8s/README.md
```

Expected: only Deployment names, HPA target, and README command references changed.

- [ ] **Step 2: Commit changes**

Run only if Boss asks to commit:

```bash
git add k8s/scheduler-deployment.yaml k8s/worker-deployment.yaml k8s/worker-hpa.yaml k8s/README.md docs/superpowers/plans/2026-06-13-codeswarm-k8s-pod-prefix.md
git commit -m "chore(k8s): prefix scheduler and worker pod names"
```

Commit message footer:

```text
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```
