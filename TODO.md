### Evolutions
- Archi
    - Sur firebase
        - DB Firestore
            - Stocke les parcours, les cartes de parcours associées (l'original + la version corrigée), les plans de parcours, et toute autre information utiles associées.
            - tout est versionné, les changements effectués entre les versions sont enregistrés
            - l'accès aux données se fait soit par recherche géographiques (parcours autour d'un lieu), par nom de parcours (peut être approximatif), par identifiant de parcours
        - serverless nodejs pour les APIs
        - IHM sur GCS
        - Accès aux APIs via authentification/habilitation (en se basant sur l'IDP google)
- Environnements Firebase
    - 1 seul environnement pour l'instant mais il faut sécuriser les données en base. Il faut faire des copies (sauvegardes ?) régulièrement
- IHM
    - Ecran accueil
        - carte de France avec tous les parcours en base
        - stats : nombre de parcours, %qualité, ...
        - derniers parcours ajoutés
        - derniers parcours édités
    - Ecran recherche parcours
        - options : recherche sur OSM, Base ou les 2
        - Recherche par nom de parcours (peut être approximatif). Si plusieurs parcours sont trouvés on demande à l'utilisateur de sélectionner celui qu'il souhaite. Un clic sur le parcours l'amène vers l'écran de détail de parcours
        - Recherche par zone
            - options : parcours avec niveau de qualité donné, rayon de la zone
            - Résultat recherche : affichage sous forme de liste ou carte
                - indicateur précisant si le parcours est en base et ou sur OSM
                - indicateur précisant la qualité du parcours (1 pour OSM, 1 pour en base) avec possibilité d'afficher le détail
    - Ecran détail parcours
        - page avec 
            - un header 
                - un menu déroulant permettant de naviguer vers d'autres pages, une flèche de retour pour revenir à la page précédente
                - une partie donnant le nom du parcours, ses indicateurs qualité
                - une partie avec des boutons ou cases à cocher permettant d'effectuer des opérations sur la partie body
            - un body avec plusieurs zones verticales qui peuvent être pliées/dépliées
                - partie parcours en base. Déplié si existe en base, plié sinon
                - partie parcours OSM. Plié par défaut si le parcours en base existe. Lorsqu'on le déplie, on va chercher les informations sur OSM (ou dans le cache si les informations ont déjà été requêtées). Un bouton refresh permet de forcer le requêtage OSM. Un bouton editer sur OSM renvoie vers la page d'édition OSM du parcours
                - partie carte de parcours (pliée par défaut). Quand déplié, on affiche au choix (en base, cgolf, autre) la carte correspondante
        - affiche le delta : un bouton dans le header permet d'activer ou désactiver l'affichage du delta. Lorsqu'on l'active (possible uniquement lorsque 2 zones au moins sont dépliées) on demande qui est la référence de comparaison : OSM, base ou carte
            - le delta affiché est basé sur le même principe que sur la version OSM proxy
        - édition
            - les éditions se font en 2 étapes : une en mode dry run sur la session en cours (les modifications ne sont pas propagées), la 2nd étape avec la propagation des modifications sur les systèmes concernés (en base et/ou sur OSM)
            - fonctionnalités : 
                - edition carte de parcours : switch front/back, composition parcours (la carte est une composition de plusieurs parcours), édition manuelle tableau (on peut changer certains valeurs du tableau de la carte de parcours)
                - report carte de parcours sur OSM et/ou base
                - report OSM vers base ou vice versa
                - association ref green
                - association ref et couleur tee
                - détection des zones (fairway, bunker, green, tee)
                - etc.





