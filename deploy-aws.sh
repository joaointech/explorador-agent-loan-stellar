#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# deploy-aws.sh web [--tag TAG] [--build-only|--deploy-only] [--stack]
#
# Build explorador advance (apps/web), push to ECR, and roll it out on the
# shared AWS swarm (eu-west-2, account 904776124553) behind prod-apps-alb, at
# https://advance.explorador.ai. Adapted from irrealista's deploy-aws.sh:
# build (here with LOCAL_BUILD=1, else on the swarm worker) -> push ECR -> roll
# the swarm service. Runtime config comes from Secrets Manager
# (prod-advance-web-env, dotenv text), written to web.env next to the stack
# file on the manager and injected via env_file. The image takes no build args.
#
# One deployable, `web`: deploy/Dockerfile (context = repo root) -> swarm
# service advance_web (deploy/stack-aws.yml), host port 8106 -> 3000. The
# container applies pending Prisma migrations before the server starts.
#
# Local runs use the bitnata-new profile; CI exports AWS_PROFILE="" to fall back
# to ambient env credentials. Node IPs are looked up by tag. bash 3.2 (macOS).
# ============================================================================

export AWS_PROFILE="${AWS_PROFILE-bitnata-new}"
[ -z "$AWS_PROFILE" ] && unset AWS_PROFILE

REGION=eu-west-2
ECR=904776124553.dkr.ecr.eu-west-2.amazonaws.com
REPO=advance-web
STACK=advance
SWARM_SERVICE="${STACK}_web"
SECRET_ID=prod-advance-web-env
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_rsa}"
STACK_DIR=/home/ubuntu/advance                          # stack file + web.env on the manager
BUILD_DIR="${BUILD_DIR:-/home/ubuntu/advance-build-web}" # repo copy on the worker (builds without LOCAL_BUILD)

usage="usage: deploy-aws.sh web [--tag TAG] [--build-only|--deploy-only] [--stack]"
[ "${1:-}" = "web" ] || { echo "$usage"; exit 1; }
shift
TAG=""; DO_BUILD=1; DO_DEPLOY=1; FORCE_STACK=0
while [ $# -gt 0 ]; do
  case "$1" in
    --tag)         TAG="${2:?--tag needs a value}"; shift 2 ;;
    --build-only)  DO_DEPLOY=0; shift ;;
    --deploy-only) DO_BUILD=0;  shift ;;
    --stack)       FORCE_STACK=1; shift ;;   # re-apply stack-aws.yml (ports/env/healthcheck edits), not just the image
    *) echo "unknown arg: $1"; echo "$usage"; exit 1 ;;
  esac
done
TAG="${TAG:-prod-$(git rev-parse --short HEAD)}"
IMG="$ECR/$REPO:$TAG"

SSH="ssh -i $SSH_KEY -o StrictHostKeyChecking=no -o BatchMode=yes -o ConnectTimeout=15"
SCP="scp -i $SSH_KEY -o StrictHostKeyChecking=no -o BatchMode=yes"
lookup_ip() {
  aws ec2 describe-instances --region "$REGION" \
    --filters "Name=tag:Name,Values=$1" "Name=instance-state-name,Values=running" \
    --query 'Reservations[].Instances[].PublicIpAddress' --output text | awk '{print $1}'
}
MANAGER=$(lookup_ip prod-apps-manager)
WORKER=$(lookup_ip prod-apps-worker)
[ -n "$MANAGER" ] && [ -n "$WORKER" ] || { echo "could not resolve node IPs"; exit 1; }
echo "manager=$MANAGER worker=$WORKER service=$SWARM_SERVICE tag=$TAG"

# Secrets Manager holds dotenv text (the shape of apps/web/.env.local), but
# docker's env_file takes everything after `=` verbatim: `KEY="a b"` keeps its
# quotes and `KEY=v  # note` its comment, which would break e.g.
# STELLAR_NETWORK_PASSPHRASE and DATABASE_URL. Normalize to plain KEY=value:
# drop comments, blank lines and `export `, unquote quoted values (no escapes,
# single-line), cut ` #…` comments off unquoted ones.
dotenv_to_env_file() {
  awk '
    /^[ \t]*(#|$)/ { next }
    {
      line = $0
      sub(/\r$/, "", line)
      sub(/^[ \t]*export[ \t]+/, "", line)
      eq = index(line, "=")
      if (eq == 0) next
      key = substr(line, 1, eq - 1); gsub(/[ \t]/, "", key)
      val = substr(line, eq + 1); sub(/^[ \t]+/, "", val)
      q = substr(val, 1, 1)
      if ((q == "\"" || q == "\047") && index(substr(val, 2), q) > 0) {
        val = substr(val, 2, index(substr(val, 2), q) - 1)
      } else {
        sub(/[ \t]+#.*$/, "", val)
        sub(/[ \t]+$/, "", val)
      }
      print key "=" val
    }'
}

# Remote env-drift check (runs on the manager, see the deploy section). Kept
# in a variable so no quoting has to survive ssh/heredoc layering.
# `read -d ''` (not `$(cat <<EOS)`): bash 3.2 on macOS parses heredoc bodies
# inside $() and trips on the `case` patterns below.
read -r -d '' ENV_DRIFT_SCRIPT <<'EOS' || true
set -e
f="$1"; svc="$2"
sudo docker service inspect "$svc" \
  --format '{{range .Spec.TaskTemplate.ContainerSpec.Env}}{{println .}}{{end}}' > /tmp/have.$$
missing=""; changed=""
while IFS= read -r line; do
  case "$line" in ''|'#'*) continue ;; esac
  key="${line%%=*}"; val="${line#*=}"
  case "$val" in
    \"*\") val="${val#\"}"; val="${val%\"}" ;;
    \'*\') val="${val#\'}"; val="${val%\'}" ;;
  esac
  have=$(grep -m1 "^$key=" /tmp/have.$$ || true)
  if [ -z "$have" ]; then missing="$missing $key"
  elif [ "${have#*=}" != "$val" ]; then changed="$changed $key"; fi
done < "$f"
rm -f /tmp/have.$$
[ -n "$missing" ] && echo "missing:$missing"
[ -n "$changed" ] && echo "changed:$changed"
exit 0
EOS

# ---- build + push ----
# Two modes. LOCAL_BUILD=1 (the CI default: a GitHub-hosted ubuntu-latest
# runner, amd64 like the swarm, with more RAM than the 4GB worker): build HERE
# and push, no rsync, no ssh-to-worker, no build contention on the swarm. Unset
# (a local run, e.g. an arm64 Mac): rsync the repo -> worker and build ON the
# worker, so the image arch always matches the swarm regardless of the laptop.
if [ "$DO_BUILD" = 1 ]; then
  token=$(aws ecr get-login-password --region "$REGION")
  if [ "${LOCAL_BUILD:-0}" = 1 ]; then
    # No local prune here (unlike irrealista's persistent NUC runner): CI
    # runners are fresh, and on a laptop it would delete unrelated images.
    echo "$token" | docker login --username AWS --password-stdin "$ECR" >/dev/null 2>&1
    echo ">> building web (local, linux/amd64) -> $IMG"
    DOCKER_BUILDKIT=1 docker build --platform linux/amd64 -f deploy/Dockerfile -t "$IMG" .
    docker push "$IMG"
  else
    rsync -az --delete \
      --exclude='.git' --exclude='node_modules' --exclude='.next' --exclude='target' \
      --exclude='.claude' --exclude='.env*' --exclude='apps/web/lib/generated' \
      -e "$SSH" ./ "ubuntu@$WORKER:$BUILD_DIR/"
    echo ">> building web (on worker) -> $IMG"
    $SSH "ubuntu@$WORKER" "
      set -e
      cd $BUILD_DIR
      sudo docker container prune -f >/dev/null 2>&1 || true
      sudo docker image prune -af --filter 'until=72h' >/dev/null 2>&1 || true
      sudo docker builder prune -af --filter 'until=72h' >/dev/null 2>&1 || true
      echo '$token' | sudo docker login --username AWS --password-stdin $ECR >/dev/null 2>&1
      DOCKER_BUILDKIT=1 sudo docker build -f deploy/Dockerfile -t $IMG .
      sudo docker push $IMG"
  fi
fi

# ---- deploy (on the manager) ----
if [ "$DO_DEPLOY" = 1 ]; then
  # One deploy at a time against the swarm (same lock scheme as irrealista:
  # two updates reaching the manager together fail with "update out of
  # sequence"). mkdir is the lock because it is atomic over ssh; a lock older
  # than 20 minutes belongs to a run that died, and is taken over.
  DEPLOY_LOCK=/tmp/${STACK}-deploy.lock
  envtmp=""
  cleanup() {
    [ -n "$envtmp" ] && rm -f "$envtmp"
    $SSH "ubuntu@$MANAGER" "rmdir $DEPLOY_LOCK 2>/dev/null" || true
  }
  waited=0
  until $SSH "ubuntu@$MANAGER" "mkdir $DEPLOY_LOCK 2>/dev/null"; do
    # 255 is ssh itself failing, not mkdir: an unreachable manager is not a
    # held lock, and must not read as one for 25 minutes.
    [ "$?" = 255 ] && { echo "cannot reach the manager to take the deploy lock"; exit 1; }
    $SSH "ubuntu@$MANAGER" "find $DEPLOY_LOCK -maxdepth 0 -mmin +20 -exec rmdir {} \\; 2>/dev/null" || true
    [ "$waited" -ge 1500 ] && { echo "another deploy has held $DEPLOY_LOCK for 25 minutes"; exit 1; }
    [ "$waited" = 0 ] && echo "  another deploy is updating the swarm, waiting"
    sleep 10; waited=$((waited + 10))
  done
  trap cleanup EXIT

  $SSH "ubuntu@$MANAGER" "mkdir -p $STACK_DIR"
  $SCP deploy/stack-aws.yml "ubuntu@$MANAGER:$STACK_DIR/stack-aws.yml"

  # web.env from Secrets Manager (normalized, see dotenv_to_env_file)
  envtmp=$(mktemp "${TMPDIR:-/tmp}/advance-web-env.XXXXXX")
  aws secretsmanager get-secret-value --region "$REGION" --secret-id "$SECRET_ID" \
    --query SecretString --output text | dotenv_to_env_file > "$envtmp"
  grep -q '^DATABASE_URL=.' "$envtmp" || { echo "$SECRET_ID has no DATABASE_URL"; exit 1; }
  $SCP "$envtmp" "ubuntu@$MANAGER:$STACK_DIR/web.env"
  $SSH "ubuntu@$MANAGER" "chmod 600 $STACK_DIR/web.env"
  rm -f "$envtmp"; envtmp=""

  existing=$($SSH "ubuntu@$MANAGER" "sudo docker service ls --format '{{.Name}}' | grep -x '$SWARM_SERVICE' || true")
  $SSH "ubuntu@$MANAGER" "aws ecr get-login-password --region $REGION | sudo docker login --username AWS --password-stdin $ECR >/dev/null 2>&1"

  # A stack deploy is needed when the service doesn't exist yet (bootstrap),
  # with --stack, or when web.env no longer matches the running service's env:
  # `service update --image` keeps the env baked in at the last stack deploy,
  # so a Secrets Manager change would never reach the container. The remote
  # script prints the KEYS whose value in the file is missing from / different
  # to the running spec; stack-file `environment:` entries are ignored.
  need_stack=$FORCE_STACK
  if [ -z "$existing" ]; then
    echo "  $SWARM_SERVICE does not exist yet -> stack deploy"
    need_stack=1
  else
    drift=$(printf '%s' "$ENV_DRIFT_SCRIPT" | $SSH "ubuntu@$MANAGER" bash -s -- "$STACK_DIR/web.env" "$SWARM_SERVICE")
    if [ -n "$drift" ]; then
      echo "  env drift on $SWARM_SERVICE ($(echo "$drift" | tr '\n' ' ')) -> stack deploy"
      need_stack=1
    fi
  fi

  if [ "$need_stack" = 1 ]; then
    # `sudo env …` (not `sudo -E`): -E keeps HOME=/home/ubuntu, so docker never
    # sees root's ECR login and --with-registry-auth ships NO credentials ->
    # nodes without their own login reject the task ("no basic auth credentials").
    $SSH "ubuntu@$MANAGER" "cd $STACK_DIR && sudo env WEB_TAG=$TAG \
      docker stack deploy --with-registry-auth -c stack-aws.yml $STACK"
    echo "  stack $STACK deployed (WEB_TAG=$TAG)"
  else
    # --force: also re-pull/roll when the tag is unchanged (re-deploy of a
    # tag that failed to pull, e.g. a node without registry credentials).
    $SSH "ubuntu@$MANAGER" "sudo docker service update --force --with-registry-auth \
      --image $IMG $SWARM_SERVICE"
    echo "  rolled $SWARM_SERVICE -> $IMG"
  fi

  # A stack deploy returns at once: wait for a task on $TAG to be Running (with
  # a healthcheck, swarm reports Running only once it is healthy), so a green
  # run is a live deploy. A rolled-back update or 8 minutes without it fails.
  echo "  waiting for $SWARM_SERVICE to run $TAG"
  waited=0
  while :; do
    update=$($SSH "ubuntu@$MANAGER" "sudo docker service inspect $SWARM_SERVICE \
      --format '{{if .UpdateStatus}}{{.UpdateStatus.State}}{{end}}'" || true)
    case "$update" in
      rollback_*) echo "  update rolled back ($update); see: sudo docker service ps --no-trunc $SWARM_SERVICE"; exit 1 ;;
    esac
    tasks=$($SSH "ubuntu@$MANAGER" "sudo docker service ps $SWARM_SERVICE \
      --filter desired-state=running --format '{{.Image}} {{.CurrentState}}'" || true)
    echo "$tasks" | grep ":$TAG" | grep -q " Running" && break
    [ "$waited" -ge 480 ] && { echo "  $SWARM_SERVICE is not running $TAG after 8 minutes:"; echo "$tasks"; exit 1; }
    sleep 10; waited=$((waited + 10))
  done
  echo "  $SWARM_SERVICE is running $TAG"

  # reclaim disk on the manager (it pulls images on every stack deploy)
  $SSH "ubuntu@$MANAGER" "
    sudo docker container prune -f >/dev/null 2>&1 || true
    sudo docker image prune -af --filter 'until=72h' >/dev/null 2>&1 || true" || true
fi
echo "done."
