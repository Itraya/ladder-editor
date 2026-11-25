# Ladder Editor (style Control Expert)

Éditeur graphique de ladder pour VS Code. Ouvre un fichier `*.ladder.json` (ou commande **Ladder: Nouveau fichier ladder**).

- Grille de 11 colonnes ; la dernière est réservée aux bobines.
- Flèches : déplacer. `1` NO, `2` NF, `3` front montant, `4` front descendant, `5` bobine, `6` bobine inversée, `7` Set, `8` Reset, `-` fil, `V` lien vertical (câble parallèle), `Suppr` effacer, `Entrée` nom de variable.
- Un câble parallèle = deux lignes reliées par un lien vertical à gauche et à droite du groupe (voir `exemple.ladder.json`).
- **Exporter en ST** génère du Structured Text.

Limites : pas de blocs fonctions / opérations, pas de mode en ligne, raccourcis propres à cette extension.
