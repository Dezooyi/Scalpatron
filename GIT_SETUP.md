# 🚀 Git Einrichtung für Scalpatron

## Schnell-Start (Copy & Paste)

### 1. Git initialisieren

```bash
cd i:\ARBEIT_2026\_Antigravity_Workspace\Solana_BotTrader00
git init
```

### 2. .gitignore erstellen (wichtig!)

```bash
# Diese Datei schützt sensible Daten
```

**Inhalt für `.gitignore`:**
```
# Environment Variables (SENSIBLE DATEN!)
.env
.env.local
.env.*.local

# Node.js
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Logs
logs/
*.log

# Database
*.sqlite
*.db

# IDE
.vscode/
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Build
dist/
build/

# Temp
tmp/
temp/
```

### 3. Git User konfigurieren (einmalig)

```bash
# Dein GitHub Name und Email
git config --global user.name "DeinGitHubName"
git config --global user.email "deine@email.com"
```

### 4. Alle Dateien hinzufügen

```bash
# Alle Dateien zum Git hinzufügen
git add .
```

### 5. Erster Commit

```bash
# Speichert den aktuellen Stand
git commit -m "Initial commit: Scalpatron v2.1"
```

### 6. Mit GitHub verbinden

```bash
# GitHub Repo als Remote hinzufügen
# Ersetze DEIN_GITHUB_USERNAME mit deinem echten Username!
git remote add origin https://github.com/DEIN_GITHUB_USERNAME/Scalpatron.git

# Hauptbranch umbenennen
git branch -M main

# Zum GitHub Repo pushen
git push -u origin main
```

---

## 🔐 GitHub Authentication

### Option A: Personal Access Token (Empfohlen)

1. **Token erstellen:**
   - GitHub → Settings → Developer settings → Personal access tokens
   - "Generate new token (classic)"
   - Haken bei: `repo` (Full control of private repositories)
   - Token kopieren (z.B. `ghp_xxxxxxxxxxxxx`)

2. **Token speichern:**
   ```bash
   git config --global credential.helper store
   ```

3. **Beim ersten Push:**
   - Username: Dein GitHub Username
   - Password: Das Token (nicht dein GitHub Passwort!)

### Option B: GitHub CLI (Einfacher)

```bash
# GitHub CLI installieren
winget install GitHub.cli

# Anmelden
gh auth login

# Folge den Anweisungen im Terminal
```

---

## 📋 Wichtige Dateien prüfen

### Vor dem Push sicherstellen:

**Nicht committen (sensible Daten):**
- ❌ `.env` (enthält Private Keys!)
- ❌ `node_modules/`
- ❌ `*.sqlite` (Datenbank)
- ❌ `logs/`

**Committen (Projekt-Dateien):**
- ✅ `src/` (Source Code)
- ✅ `frontend/` (Frontend Code)
- ✅ `package.json`
- ✅ `README.md`
- ✅ `.docs/` (Dokumentation)
- ✅ `tsconfig.json`

---

## 🔄 Nach der Einrichtung

### Projekt aktualisieren (nach Änderungen)

```bash
# Alle Änderungen hinzufügen
git add .

# Committen mit Nachricht
git commit -m "Neues Feature: XYZ hinzugefügt"

# Pushen zu GitHub
git push
```

### Status prüfen

```bash
# Welche Dateien haben sich geändert?
git status

# Wer hat was geändert?
git log --oneline
```

---

## ⚠️ WICHTIG: .env Datei schützen

### 1. .env zur .gitignore hinzufügen

Stelle sicher, dass `.env` in der `.gitignore` steht:
```
.env
```

### 2. .env.example erstellen (für andere Entwickler)

```bash
# Kopiere .env als Vorlage ohne sensible Daten
copy .env .env.example
```

**Inhalt von `.env.example`:**
```env
# Kopiere alle Variablennamen, aber ersetze die Werte
SOLANA_RPC_URL=https://api.devnet.solana.com
WALLET_PRIVATE_KEY=              # Leer lassen!
UGOR_MINT=UGoRwdj9SK78V6Pq9YMz9BvmNuJTLNqPZyS5WnGd8uW
PRICE_FEED_PROVIDER=dexscreener
# ... etc
```

### 3. .env.example committen

```bash
git add .env.example
git commit -m "Add .env.example template"
git push
```

---

## 🛠️ Häufige Befehle

| Befehl | Beschreibung |
|--------|--------------|
| `git status` | Zeigt geänderte Dateien |
| `git add .` | Fügt alle Änderungen hinzu |
| `git commit -m "..."` | Speichert Änderungen |
| `git push` | Lädt zu GitHub hoch |
| `git pull` | Lädt von GitHub herunter |
| `git log --oneline` | Zeigt Commit-Historie |
| `git diff` | Zeigt Änderungen |

---

## 📁 Projekt-Struktur für GitHub

```
Scalpatron/
├── .docs/                    # ✅ Dokumentation
├── frontend/                 # ✅ Frontend Code
├── src/                      # ✅ Backend Code
├── .env.example              # ✅ Vorlage (ohne Keys!)
├── .gitignore                # ✅ Ignore-Regeln
├── package.json              # ✅ Dependencies
├── README.md                 # ✅ Beschreibung
├── tsconfig.json             # ✅ TypeScript Config
├── .env                      # ❌ NICHT committen!
├── node_modules/             # ❌ NICHT committen!
├── logs/                     # ❌ NICHT committen!
└── *.sqlite                  # ❌ NICHT committen!
```

---

## ✅ Checkliste vor erstem Push

- [ ] `.gitignore` erstellt
- [ ] `.env` ist in `.gitignore`
- [ ] `.env.example` erstellt (ohne sensible Daten)
- [ ] Git User konfiguriert
- [ ] GitHub Repo URL korrekt
- [ ] Personal Access Token erstellt

---

## 🆘 Hilfe bei Problemen

### "fatal: remote origin already exists"
```bash
git remote remove origin
git remote add origin https://github.com/USERNAME/Scalpatron.git
```

### "Authentication failed"
- Token überprüfen
- `git config --global --unset credential.helper`
- Erneut anmelden

### "Everything up-to-date" aber nichts auf GitHub?
```bash
git push -u origin main
```

---

**Viel Erfolg! 🚀**

Bei Fragen einfach melden.
