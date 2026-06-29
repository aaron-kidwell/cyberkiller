#!/bin/bash
# Build all 8 real CVE-based KOTH target images from vulhub base images.
# Each image layers SSH + supervisor + KOTH flag entrypoint on top of a
# real vulnerable application from the vulhub project.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

declare -A TARGETS=(
  [apache-rce]="docker/vulnhub/apache-rce/Dockerfile"
  [shellshock]="docker/vulnhub/shellshock/Dockerfile"
  [tomcat-upload]="docker/vulnhub/tomcat-upload/Dockerfile"
  [struts-ognl]="docker/vulnhub/struts-ognl/Dockerfile"
  [log4shell]="docker/vulnhub/log4shell/Dockerfile"
  [spring4shell]="docker/vulnhub/spring4shell/Dockerfile"
  [jenkins-rce]="docker/vulnhub/jenkins-rce/Dockerfile"
  [elasticsearch-rce]="docker/vulnhub/elasticsearch-rce/Dockerfile"
)

# Ordered build list (neon → shadow → citadel)
BUILD_ORDER=(apache-rce shellshock tomcat-upload struts-ognl log4shell spring4shell jenkins-rce elasticsearch-rce)

echo "[ck] Building ${#BUILD_ORDER[@]} CVE target images..."
for name in "${BUILD_ORDER[@]}"; do
  dockerfile="${TARGETS[$name]}"
  tag="cyberkiller/target-${name}:latest"
  echo "  -> $tag  ($dockerfile)"
  docker build --pull=false -t "$tag" -f "$dockerfile" "$ROOT" 2>&1 | \
    grep -E "^(Step|#[0-9]|ERROR|error|Successfully|COPY|RUN|FROM)" || true
  echo "     built ✓"
done

echo "[ck] Done. Seed registry: docker exec -i ck-db psql -U cyberkiller -d cyberkiller < local/seed-target-images.sql"
