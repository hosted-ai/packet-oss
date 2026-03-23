# MLflow Recipe

One-click deployment of MLflow Tracking Server for experiment tracking, model registry, and artifact management.

## What Gets Installed
- MLflow with extras (including REST API server)
- scikit-learn and XGBoost for ML experimentation
- SQLite backend store and local artifact storage
- Systemd service (auto-starts on boot)

## Ports
| Port | Protocol | Service              |
|------|----------|----------------------|
| 5000 | HTTP     | MLflow Tracking UI   |

## Resource Requirements
- **Minimum RAM**: 2 GB
- **Recommended RAM**: 4 GB+
- **Disk**: 10 GB + experiment artifact storage

## Post-Deploy Usage
```bash
# Access the tracking UI
open http://localhost:5000

# Log an experiment from Python
import mlflow
mlflow.set_tracking_uri("http://localhost:5000")
with mlflow.start_run():
    mlflow.log_param("learning_rate", 0.01)
    mlflow.log_metric("accuracy", 0.95)

# Check service status
systemctl status mlflow
```

## Data Directories
- **Database**: /home/ubuntu/mlflow-data/db/mlflow.db
- **Artifacts**: /home/ubuntu/mlflow-data/artifacts/

## Testing
1. Verify service: `systemctl status mlflow`
2. Verify web UI: `curl http://localhost:5000`
3. Create a test experiment via the web UI or Python SDK
