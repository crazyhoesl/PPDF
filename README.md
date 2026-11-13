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

État au 13/11/2026 (la source de vérité reste `scripts/providers.mjs`) :

| Provider      | Model                      | Secret name       | Repli OpenRouter                  |
|---------------|----------------------------|-------------------|-----------------------------------|
| Google Gemini | `gemini-3.1-pro-preview`   | `GEMINI_API_KEY`  | `google/gemini-3.1-pro-preview`   |
| Mistral       | `mistral-medium-2604`      | `MISTRAL_API_KEY` | `mistralai/mistral-medium-3-5`    |
| xAI Grok      | `grok-4-1-fast-reasoning`  | `XAI_API_KEY`     | —                                 |
| OpenAI        | `gpt-5.6-sol`              | `OPENAI_API_KEY`  | `openai/gpt-5.6-sol`              |
| Anthropic     | `claude-fable-5`           | `CLAUDE_API_KEY`  | —                                 |

Si un secret manque et qu'il n'y a pas de repli, le provider est simplement sauté (aucun crash). Ajouter les secrets sous `Settings → Secrets and variables → Actions`.

### Repli via OpenRouter

Chaque provider est d'abord interrogé **directement**. Si l'appel échoue (quota, crédit, panne), le même prompt part vers le **même modèle via OpenRouter** (`OPENROUTER_API_KEY`, crédit prépayé). Le résultat note la route (`route: "direct" | "openrouter"`) et, le cas échéant, l'erreur directe (`direct_error`) ; le site affiche « via OpenRouter » sur la carte.

Pourquoi : depuis l'automne 2026, trois comptes directs échouent chaque jour en HTTP 429 —
- **Gemini** : Google a mis le quota gratuit de `gemini-3.1-pro` à 0 (depuis le 19/10). Les modèles Flash restent gratuits, Pro exige la facturation.
- **Mistral** : le compte renvoie `x-ratelimit-limit-req-minute=0` sur **tous** les modèles (depuis le 04/09) — ce n'est pas une vraie limite de débit, le plan a expiré.
- **OpenAI** : `credit_balance_exhausted` (depuis le 01/11).

Coût mesuré via OpenRouter : environ 0,015 $ par jour pour les trois. Dès qu'un compte direct refonctionne, la route directe reprend d'elle-même.

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
