# Éditeur de partition ABC — application installable (PWA)

## Contenu
- `index.html` : l'application
- `abc-score-editor.js` : l'éditeur (interface + API)
- `manifest.webmanifest`, `icons/` : identité de l'app (nom, icônes)
- `sw.js` : mode hors ligne
- `vendor/` : dossier optionnel pour héberger abcjs vous-même (voir `vendor/LISEZ-MOI.txt`)

## Publier (obligatoire : HTTPS)
Une PWA ne s'installe que depuis une adresse en **https://** (ou `localhost` pour tester).
Déposez simplement le dossier tel quel sur un hébergement statique :
- **GitHub Pages** : créez un dépôt, envoyez les fichiers, activez Pages ;
- **Netlify / Cloudflare Pages** : glissez-déposez le dossier ;
- votre propre site : copiez le dossier dans un sous-répertoire (ex. `https://monsite.fr/partition/`).
Le dossier peut être placé n'importe où : tous les chemins sont relatifs.

Test local : `python3 -m http.server 8000` dans le dossier, puis http://localhost:8000

## Installer
- **Chrome / Edge (ordinateur, Android)** : bouton « Installer l'app » de la page, ou icône d'installation dans la barre d'adresse.
- **iPad / iPhone (Safari)** : Partager ▸ Sur l'écran d'accueil.

## Hors ligne
Au premier lancement (connecté), l'app se met en cache : ensuite elle s'ouvre sans Internet.
La partition en cours est sauvegardée automatiquement sur l'appareil et se recharge à l'ouverture.
Exportez en JSON (Fichier ▸ Exporter) pour l'archiver ou la transférer sur un autre appareil.

## Mettre à jour
Après avoir modifié des fichiers, changez `VERSION` dans `sw.js` (ex. `'v2'`) puis republiez :
les appareils récupèrent la nouvelle version à la prochaine ouverture.
