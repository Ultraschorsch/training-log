# Training Log

Selbst gehosteter Trainings-Tracker unter `fitness.oachkatzl.me` (Dockhand-Stack `training-log`, CT 102, Port 30280, hinter Pangolin-SSO).

## Aufbau
- `frontend/` – `index.html` (komplette App) + `nginx.conf` (leitet `/api/` an das Backend weiter)
- `backend/server.js` – kleine Node-API, speichert alles in einer JSON-Datei
- `compose.yaml` – baut beide Images, nutzt das bestehende Volume `training-log_training_data` (external)

## API
| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/api/plans` | beide Pläne |
| PUT | `/api/plans/{A,B}/exercises` | Übungsliste eines Plans ersetzen |
| GET | `/api/sessions?plan=&limit=` | Trainings |
| POST | `/api/sessions` | Training speichern |
| DELETE | `/api/sessions/{id}` | Training löschen |
| GET | `/api/health` | 200 nur wenn Datei lesbar und beide Pläne Übungen haben |

## Schutz der Daten
- Vor jedem Schreiben legt der Server eine Kopie unter `/data/backups/` ab (die letzten 60, `BACKUP_KEEP`).
- Geschrieben wird atomar (tmp-Datei + rename).
- Ist die Datendatei unlesbar, antwortet der Server mit 500 und schreibt nichts.
- Einen Plan mit mehr als einer Übung komplett zu leeren, wird abgelehnt (409).
- Das Volume ist `external` – ein „Down“ oder Löschen des Stacks entfernt es nicht.
- Zusätzlich sichert der nächtliche PBS-Job CT 102 inkl. Docker-Volumes.

## Wiederherstellen aus einer Kopie
In Dockhand: Container `training-backend` → Files → `/data/backups/` → gewünschte Datei als `/data/training-log.json` zurückkopieren, dann Container neu starten.

## Änderungen
Code hier im Repo ändern, pushen, in Dockhand beim Stack „Redeploy“ bzw. Git-Update. Keine Dateien mehr direkt auf CT 102 bearbeiten.
