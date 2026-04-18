# PPDF — Prochain Président de la France

**Quelles IA pensent-elles qui sera le prochain président de la France ?**

Un projet expérimental : chaque jour à 07:00 UTC, un workflow GitHub Actions interroge plusieurs modèles d'IA avec exactement la même question et archive leurs réponses. Le site web affiche un compte à rebours jusqu'au second tour de la présidentielle 2027, les dernières réponses, une chronologie cliquable et un décompte global.

🇫🇷 Construit avec curiosité · 🤖 Pas une prévision · ⏳ Rendez-vous le 25 avril 2027

---

## Live site

GitHub Pages : **[crazyhoesl.github.io/PPDF](https://crazyhoesl.github.io/PPDF/)**

(Activer Pages : `Settings → Pages → Source: Deploy from a branch → Branch: main /docs`)

---

## Comment ça marche

```
┌───────────────┐   cron 07:00 UTC   ┌─────────────────┐
│ GitHub Action │ ─────────────────► │  scripts/poll   │
└───────────────┘                    └────────┬────────┘
                                              │ fan-out
                          ┌───────────────────┼───────────────────┐
                          ▼                   ▼                   ▼
                    ┌──────────┐        ┌──────────┐        ┌──────────┐
                    │  Gemini  │        │ Mistral  │  ...   │ Cerebras │
                    └─────┬────┘        └────┬─────┘        └─────┬────┘
                          └────────────┬─────┴──────────┬─────────┘
                                       ▼                ▼
                                 data/latest.json  data/history/YYYY-MM-DD.json
                                       │
                                       ▼
                                 git commit & push
                                       │
                                       ▼
                                 GitHub Pages rebuild
```

## Providers

Tous ont un **free tier** généreux, sans carte de crédit :

| Provider    | Model                       | Secret name          | Sign up |
|-------------|-----------------------------|----------------------|---------|
| Google Gemini | `gemini-2.5-flash`        | `GEMINI_API_KEY`     | [aistudio.google.com](https://aistudio.google.com/apikey) |
| Mistral     | `mistral-large-latest`      | `MISTRAL_API_KEY`    | [console.mistral.ai](https://console.mistral.ai/api-keys) |
| Groq        | `llama-3.3-70b-versatile`   | `GROQ_API_KEY`       | [console.groq.com](https://console.groq.com/keys) |
| OpenRouter  | `deepseek-chat-v3.1:free`   | `OPENROUTER_API_KEY` | [openrouter.ai](https://openrouter.ai/keys) |
| Cerebras    | `llama-3.3-70b`             | `CEREBRAS_API_KEY`   | [cloud.cerebras.ai](https://cloud.cerebras.ai/) |
| OpenAI      | `gpt-4o-mini`               | `OPENAI_API_KEY`     | [platform.openai.com](https://platform.openai.com/api-keys) |
| Anthropic   | `claude-haiku-4-5`          | `CLAUDE_API_KEY`     | [console.anthropic.com](https://console.anthropic.com/) |

Si un secret manque, le provider est simplement sauté (aucun crash). Ajouter les secrets sous `Settings → Secrets and variables → Actions`.

## Structure du repo

```
PPDF/
├── .github/workflows/daily-poll.yml   # cron + workflow_dispatch
├── scripts/
│   ├── poll.mjs                        # entry point
│   ├── providers.mjs                   # 5 adaptateurs API
│   └── candidates.mjs                  # normalisation des noms
├── data/
│   ├── latest.json                     # dernière exécution
│   ├── history-index.json              # liste des dates disponibles
│   └── history/YYYY-MM-DD.json         # un fichier par jour
└── docs/                               # GitHub Pages root
    ├── index.html
    ├── app.js                          # rendu du site
    ├── style.css                       # design Mercedes-inspiré
    └── i18n.js                         # FR, EN, DE, IT, ES
```

## Déclencher manuellement

Workflow dispatch depuis l'onglet Actions, ou en local :

```bash
export GEMINI_API_KEY=...
export MISTRAL_API_KEY=...
# etc.
node scripts/poll.mjs
```

## Ajouter un provider

1. Ajouter une fonction `call(apiKey, prompt) → string` dans `scripts/providers.mjs`
2. L'ajouter au tableau `providers` exporté
3. Ajouter le secret correspondant dans le workflow
4. Ajouter le secret dans GitHub → c'est tout

## Limites et honnêteté

- Ces modèles répondent sur base de leurs données d'entraînement (et parfois avec recherche web selon le provider). Ils ont tous des biais différents et une fraîcheur différente.
- La normalisation des noms est basique : un alias manquant peut envoyer quelqu'un dans "Unknown". Corriger dans `scripts/candidates.mjs`.
- Le site suppose que le 2<sup>e</sup> tour aura lieu le 25 avril 2027. Si la date officielle diffère, changer `TARGET` dans `docs/app.js`.

## License

MIT.
