## Démarrage de session
1. Lire `/docs/DECISIONS.md` — contexte des décisions prises
2. Confirmer la lecture avant de commencer à coder

## Développement
- Travailler une feature à la fois, dans l'ordre MVP : settings → round → shot → scorecard → stats
- Ne jamais passer à la feature suivante sans confirmation explicite
- Soumettre toute décision de conception avant de l'implémenter

## Règles strictes
- Ne JAMAIS faire de commit sans demande explicite de l'utilisateur
- Ne JAMAIS mettre à jour `DECISIONS.md` sans demande explicite de l'utilisateur
- Ne JAMAIS lire le fichier 'Temp.md'r

## Commande MAJ (OBLIGATOIRE — exécuter immédiatement et intégralement)
Quand l'utilisateur dit **"MAJ"** :
1. Mettre à jour `/docs/DECISIONS.md` avec les décisions ou changements de la session (format : `## [date] — [Feature]` / `Choix :` / `Raison :`)
2. Committer tout ce qui est en attente (fichiers modifiés + DECISIONS.md)

## Demande d'analyse de l'utilisateur
Quand l'utilisateur demande l'analyse d'une demande
1. Toujours consulter au préalable le fichier `/docs/DECISIONS.md`
2. Ne pas implémenter sans confirmation explicite de l'utilisateur