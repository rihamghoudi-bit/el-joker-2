# EL JOKER 2.0 — Claude Code Handoff

## Recommended folder
Create a NEW empty folder. Do not put the old project inside it.

Example:
mkdir EL-JOKER-2
cd EL-JOKER-2

Copy this whole handoff pack into a subfolder named `docs/` or keep it beside the project.

## First Claude Code message
Tell Claude Code:

"Read MASTER_PROMPT_CLAUDE_CODE.md and EL_JOKER_2_CLAUDE_HANDOFF.pdf completely.
Inspect the three architecture images. Then build the project from scratch.
Do not only plan: implement phase by phase, run tests after each phase, and keep
PROJECT_STATUS.md updated with completed work, failures, decisions and next steps."

## Critical rule
Do not give Claude your private keys in chat. Put secrets only in `.env`.
Use Hedera testnet, never mainnet.

## What success looks like
The jury sees six live scenarios:
1. Approved mission
2. Budget blocked
3. Duplicate payment attack blocked
4. Unverified supplier blocked
5. High-risk human approval
6. Local tampering detected against Hedera proof

The product must make one idea obvious:
AI can recommend actions, but AI cannot spend outside deterministic policy.
