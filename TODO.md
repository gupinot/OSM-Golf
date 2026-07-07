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
        - par nom de parcours, zone
            - possibilité de filtrer 
                - parcours en base uniquement, parcours OSM uniquement, les 2
                - parcours avec niveau de qualité donné
        - Affiche sous forme de liste ou carte
            - indicateur précisant si le parcours est en base et ou sur OSM
            - indicateur précisant la qualité du parcours avec possibilité d'afficher le détail
    - Ecran détail parcours
        - affiche le parcours OSM, en base, carte de parcours associée
        - affiche le delta : au choix : entre OSM et base, entre OSM et carte de parcours, entre base et carte de parcours
        - édition
            - mode dry run
            - propagation : en base et/ou sur OSM
            - fonctionnalités : 
                - edition carte de parcours : switch front/back, composition parcours (la carte est une composition de plusieurs parcours), édition manuelle tableau 
                - report carte de parcours sur OSM et/ou base
                - report OSM vers base ou vice versa
                - association ref green
                - association ref et couleur tee
                - détection des zones (fairway, bunker, green, tee)



Delta 
- parcours OSM vs base
- carte de parcours en base vs autre sur le web

