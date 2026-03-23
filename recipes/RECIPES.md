# GPU App Recipes — HAI 2.2 Migration Tracker

Migration from SSH-based bash install scripts to HAI 2.2 native Ansible recipes.
Recipes execute at the K8s layer during pod provisioning — pods arrive ready to use.

## How It Works

1. Each recipe is an Ansible playbook in `packet_recipes/{slug}/`
2. Recipes are registered in the HAI admin panel and linked to a Service
3. Services declare up to 4 exposed ports (handled by HAI, not the recipe)
4. `POST /service/i/create-instance` with `service_id` provisions a pod with the recipe
5. HAI executes the recipe, tracks status via `RecipeExecutionState`
6. Pod shows as "running" only after recipe completes successfully

## Recipe Structure

```
packet_recipes/{slug}/
  infra/{slug}.json              # Instance config (generic baseline)
  metadata/{slug}.json           # Infrastructure spec
  ansible/
    ansible.cfg                  # Ansible configuration
    playbooks/main.yml           # Main playbook (conn_check + app role)
    roles/
      conn_check/                # Connectivity check (reusable across recipes)
        tasks/main.yml
        defaults/main.yml
      {slug}/                    # App-specific installation
        tasks/main.yml
        defaults/main.yml        # Default variables (ports, versions, etc.)
    inventory/                   # Populated by HAI at runtime
    handlers/main.yml
    log/
  README.md                      # App details, ports, VRAM, testing notes
```

## Recipe Conventions

- All download/install tasks include `retries: 3` + `delay: 10`
- Recipes must be idempotent (safe to re-run)
- Use Ansible modules (`apt`, `pip`) over `shell`/`command` where possible
- Include `ansible.builtin.debug` at key milestones for log readability
- Pin versions for reproducibility
- `conn_check` role runs first in every recipe

## Migration Status

### Phase 1 — Top 5 (In Progress)

| # | App | Slug | Category | Ports | VRAM Min | Status |
|---|-----|------|----------|-------|----------|--------|
| 1 | Jupyter + PyTorch | `jupyter-pytorch` | Development | 8888 | 4 GB | ✅ Created |
| 2 | vLLM V1 + TinyLlama | `vllm-v1-tinyllama` | Inference | 8000 | 4 GB | ✅ Created |
| 3 | ComfyUI | `comfyui` | Creative | 8188 | 8 GB | ✅ Created |
| 4 | VS Code Server | `code-server` | Development | 8080 | 4 GB | ✅ Created |
| 5 | Ollama | `ollama` | Inference | 11434 | 4 GB | ✅ Created |

### Phase 2 — Remaining Apps (After Pattern Validated)

| # | App | Slug | Category | Ports | VRAM Min | Status |
|---|-----|------|----------|-------|----------|--------|
| 6 | vLLM Server | `vllm-server` | Inference | 8000 | 16 GB | ⬜ Pending |
| 7 | Text Generation WebUI | `text-generation-webui` | Inference | 7860 | 8 GB | ⬜ Pending |
| 8 | Open WebUI | `open-webui` | Inference | 3000 | 4 GB | ⬜ Pending |
| 9 | HuggingFace TGI | `huggingface-tgi` | Inference | 8080 | 16 GB | ⬜ Pending |
| 10 | Triton Inference Server | `triton-inference-server` | Inference | 8000 | 8 GB | ⬜ Pending |
| 11 | LocalAI | `localai` | Inference | 8080 | 4 GB | ⬜ Pending |
| 12 | Axolotl Fine-tuning | `axolotl-training` | Training | — | 24 GB | ⬜ Pending |
| 13 | Kohya_ss | `kohya-ss` | Training | 7860 | 12 GB | ⬜ Pending |
| 14 | AUTOMATIC1111 | `automatic1111` | Creative | 7860 | 8 GB | ⬜ Pending |
| 15 | Fooocus | `fooocus` | Creative | 7865 | 8 GB | ⬜ Pending |
| 16 | CogVideoX | `cogvideox` | Creative | 7860 | 24 GB | ⬜ Pending |
| 17 | Langflow | `langflow` | Development | 7860 | 4 GB | ⬜ Pending |
| 18 | MLflow | `mlflow` | Development | 5000 | 4 GB | ⬜ Pending |

## HAI Integration Notes

- **Service creation**: Each recipe maps to a HAI Service (created in admin panel)
- **Port exposure**: Configured on the Service (up to 4 ports), not in the recipe
- **Recipe timing**: `on_demand` — execute immediately on instance creation
- **Deploy flow**: Dashboard checks `GET /compatible-services` to determine which Deploy buttons to enable
- **Fallback**: Old SSH-based install remains available for apps without recipes

## Validation

Run `scripts/validate-recipes.sh` to check:
- Directory structure matches expected pattern
- `ansible-playbook --syntax-check` passes
- Required files present (infra JSON, metadata JSON, playbook, roles)
- `conn_check` role present in every recipe

```bash
bash scripts/validate-recipes.sh              # Validate all recipes
bash scripts/validate-recipes.sh ollama       # Validate one recipe
```

## Build & Upload

Use `scripts/upload-recipe.sh` to compress and upload recipes to the HAI admin panel.

```bash
bash scripts/upload-recipe.sh ollama            # Compress only → recipes/builds/ollama.tar.gz
bash scripts/upload-recipe.sh ollama --upload   # Compress + upload to HAI
bash scripts/upload-recipe.sh --upload          # Interactive picker + upload
```

**Upload requirements:**
- `jq` installed
- `recipes/packet_recipes/creds` file with HAI admin credentials:
  ```
  url=https://admin.hostedai.example.com
  username=admin
  password=secret
  ```
- The creds file is gitignored

**What happens on upload:**
1. Recipe directory is compressed to `recipes/builds/{slug}.tar.gz`
2. Script logs into HAI admin panel
3. If a template with the same name exists, it's deleted (idempotent)
4. Archive is uploaded via TUS protocol with metadata (name, version=git commit, category=gpuaas)
5. Template appears in HAI admin panel → can be linked to a Service
