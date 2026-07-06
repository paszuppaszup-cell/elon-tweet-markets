# Elon Musk Tweet Markets

Élő oldal: https://paszuppaszup-cell.github.io/elon-tweet-markets/

Statikus (build nélküli) weboldal, ami közvetlenül a böngészőből kérdezi le a
Polymarket nyilvános API-jait (Gamma + CLOB), szerver nélkül — így GitHub
Pages-en is működik.

- `index.html` — az aktív "Elon Musk # tweets [dátum tartomány]?" piacok listája, kattintható kártyákkal
- `market.html?id=<esemény id>` — egy piac összes sávjának élő ára/valószínűsége + ártörténet grafikon, percenkénti automatikus frissítéssel
- `calculator.html` — 4 sáv árát (centben) és egy célnyereséget beírva kiszámolja, mennyit tegyél az egyes sávokba, hogy bármelyik bejövetele esetén ugyanannyi legyen a nyereséged

## API-terhelés / rate limit

Minden lekérdezés a látogató saját böngészőjéből megy (nincs központi szerver,
ami leterhelődhetne), és a Gamma/CLOB API-k publikusan CORS-engedélyezettek
(`Access-Control-Allow-Origin: *`) — ugyanezeket hívja a polymarket.com
frontendje is. A kliens 30 másodperces `sessionStorage` cache-t használ, az
automatikus frissítés pedig percenkénti, hogy ne generáljon felesleges terhelést.

## Fejlesztés helyben

Nincs build lépés, egyszerű statikus fájlok. Bármilyen statikus szerverrel
futtatható, pl.:

```
py -3 -m http.server --directory . 5501
```
