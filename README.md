# Thuisinventaris

Een webapp die onthoudt waar je spullen liggen. Alles werkt in de browser
zelf (geen server, geen database, geen account) — je gegevens staan lokaal
opgeslagen via IndexedDB.

## Functies

- **Locaties** — maak virtuele ruimtes en opbergplekken aan (Zolder, Kast
  gang, Doos 3…) die je in elkaar kunt nesten.
- **Spullen invoeren** — naam, foto, aantal, labels en optionele
  vervaldatum per voorwerp.
- **Zoeken** — typ een trefwoord en zie meteen in welke locatie (met volledig
  pad) het voorwerp ligt.
- **QR-codes** — genereer en print een QR-code per locatie; scannen met de
  camera in de app opent direct de inhoud van die locatie.
- **Uitleenhistorie** — registreer aan wie je iets hebt uitgeleend en
  markeer het weer als terug.
- **Labels/tags** — filter al je spullen op één of meerdere labels.
- **Aantallen** — houd voorraad bij (bv. 4 reservebatterijen).
- **Vervalmeldingen** — zie op het dashboard wat binnen 30 dagen verloopt,
  met optionele browsermelding bij het openen van de app.
- **Back-up & delen** — exporteer al je gegevens als één `.json`-bestand en
  importeer dat op een ander apparaat, zodat huisgenoten dezelfde inventaris
  kunnen gebruiken (zie beperking hieronder).

## Waarom geen "echt" gedeeld account?

Dit is een volledig client-side app zonder server: dat maakt hem gratis om
te hosten en simpel om op GitHub te zetten, maar het betekent dat elk
apparaat zijn eigen lokale kopie van de data heeft. De export/import-functie
onder **Instellingen** is de pragmatische oplossing: exporteer op apparaat A,
stuur het bestand door, importeer op apparaat B.

Wil je écht live gedeeld gebruik tussen huisgenoten (automatisch synchroon,
geen los bestand nodig)? Dan is de volgende stap om de `DB`-laag in
`js/db.js` te vervangen door een gedeelde backend, bijvoorbeeld:
- **Firebase Firestore** (gratis tier, realtime sync, relatief weinig code), of
- **Supabase** (Postgres + auth, ook een gratis tier).

De rest van de app (`app.js`) roept alleen `DB.getAll / .get / .put
/ .delete / .clear` aan, dus die vervanging raakt de rest van de code
nauwelijks.

## Zelf draaien

Geen build-stap nodig. Je kunt `index.html` direct openen, maar voor
camera-toegang (QR scannen) eisen browsers meestal `https://` of
`localhost`. Lokaal testen kan bijvoorbeeld met:

```bash
npx serve .
# of
python3 -m http.server 8000
```

## Op GitHub zetten en hosten via GitHub Pages

```bash
git init
git add .
git commit -m "Eerste versie van Thuisinventaris"
git branch -M main
git remote add origin https://github.com/<jouw-gebruikersnaam>/<repo-naam>.git
git push -u origin main
```

Zet daarna in de repo-instellingen **Settings → Pages** de bron op de
`main`-branch (map `/`). Na een minuut is de app bereikbaar op
`https://<jouw-gebruikersnaam>.github.io/<repo-naam>/` — met een geldig
`https://`-adres werkt QR scannen via de camera dan ook meteen.

## Projectstructuur

```
index.html          Opbouw van de pagina en alle modals
css/style.css        Vormgeving
js/db.js              Kleine IndexedDB-laag (twee stores: locaties, spullen)
js/app.js             Alle app-logica en het renderen van de schermen
js/vendor/qrcode.js   QR-codes genereren (bundel van het npm-pakket "qrcode")
js/vendor/jsQR.js     QR-codes scannen via de camera (npm-pakket "jsqr")
```

## Bekende beperkingen

- Foto's worden als base64 in IndexedDB opgeslagen; dat werkt prima voor
  redelijke aantallen voorwerpen, maar is geen vervanging voor een echte
  media-opslag bij honderden foto's.
- Vervalmeldingen verschijnen alleen wanneer je de app open hebt staan; er
  is geen achtergrond-taak die meldingen stuurt terwijl de app dicht is.
- Zie hierboven voor de beperking rond een écht gedeeld huishouden-account.
