#!/usr/bin/env bash
# Builds the CPCV attestation circuit (spec §8.5):
#   1. circom --r1cs --wasm --sym
#   2. local powers of tau (bn128, 2^15; no download): new + contribute + prepare phase 2
#   3. groth16 setup + one zkey contribution, export verification_key.json
#   4. copy cpcv_attestation.wasm, cpcv_attestation_final.zkey and verification_key.json
#      to apps/web/zk (committed) and the vk to apps/web/public/zk
#   5. scripts/vk-to-soroban.ts: apps/web/zk/verification_key.soroban.json (deploy input)
#      and the Rust fixture contracts/shared/fixtures/groth16_fixture.rs (a real proof)
#
# Every run is a NEW trusted setup with fresh random entropy: commit the new
# artifacts and redeploy cpcv_note with the new verification key.
# Intermediate products go to circuits/build/ (gitignored). The phase-1 ptau is
# reused across runs if present; delete circuits/build to start from scratch.
#
# Usage: pnpm circuits:build   (from the repo root)
set -euo pipefail

CIRCUITS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$CIRCUITS_DIR/.." && pwd)"
BUILD="$CIRCUITS_DIR/build"
ZK_DIR="$REPO_DIR/apps/web/zk"
PUBLIC_ZK_DIR="$REPO_DIR/apps/web/public/zk"
NAME=cpcv_attestation
POWER=15

cd "$CIRCUITS_DIR"
mkdir -p "$BUILD" "$ZK_DIR" "$PUBLIC_ZK_DIR"

snarkjs() { pnpm exec snarkjs "$@"; }
entropy() { od -An -tx1 -N32 /dev/urandom | tr -d ' \n'; }
step() { printf '\n==> %s\n' "$*"; }

step "Compiling $NAME.circom ($(circom --version))"
circom "$NAME.circom" --r1cs --wasm --sym -o "$BUILD" -l "$CIRCUITS_DIR/node_modules"
snarkjs r1cs info "$BUILD/$NAME.r1cs"

PTAU="$BUILD/pot${POWER}_final.ptau"
if [[ ! -f "$PTAU" ]]; then
  step "Powers of tau: bn128, 2^$POWER (local ceremony, one contribution)"
  snarkjs powersoftau new bn128 "$POWER" "$BUILD/pot${POWER}_0000.ptau"
  snarkjs powersoftau contribute "$BUILD/pot${POWER}_0000.ptau" "$BUILD/pot${POWER}_0001.ptau" \
    --name="explorador advance phase 1" -e="$(entropy)"
  snarkjs powersoftau prepare phase2 "$BUILD/pot${POWER}_0001.ptau" "$PTAU"
  rm -f "$BUILD/pot${POWER}_0000.ptau" "$BUILD/pot${POWER}_0001.ptau"
else
  step "Reusing $PTAU"
fi

step "Groth16 setup + zkey contribution"
snarkjs groth16 setup "$BUILD/$NAME.r1cs" "$PTAU" "$BUILD/${NAME}_0000.zkey"
snarkjs zkey contribute "$BUILD/${NAME}_0000.zkey" "$BUILD/${NAME}_final.zkey" \
  --name="explorador advance phase 2" -e="$(entropy)"
snarkjs zkey verify "$BUILD/$NAME.r1cs" "$PTAU" "$BUILD/${NAME}_final.zkey"
snarkjs zkey export verificationkey "$BUILD/${NAME}_final.zkey" "$BUILD/verification_key.json"

step "Copying artifacts to apps/web/zk and apps/web/public/zk"
cp "$BUILD/${NAME}_js/$NAME.wasm" "$ZK_DIR/$NAME.wasm"
cp "$BUILD/${NAME}_final.zkey" "$ZK_DIR/${NAME}_final.zkey"
cp "$BUILD/verification_key.json" "$ZK_DIR/verification_key.json"
cp "$BUILD/verification_key.json" "$PUBLIC_ZK_DIR/verification_key.json"

step "Soroban verification key + Rust fixture (scripts/vk-to-soroban.ts)"
pnpm --dir "$REPO_DIR/scripts" run vk:soroban

step "Done"
ls -l "$ZK_DIR" "$PUBLIC_ZK_DIR"
