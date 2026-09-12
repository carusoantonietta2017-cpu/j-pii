Ragioniamo usando wayfinder.
Voglio eseguire una conversione di documenti in markdown con il modello più efficiente esistente ad oggi. Quindi devi fare una indagine di mercato per trovare il migliore.
Il modello deve essere ingrado di convertire le immagini che contengono tabelle anche storte e mostrarmi una anteprima della conversione.
Deve essere veloce e preciso. 
Ispirati a quanto fatto a simone rizzo in https://annota.ai/documents/, lui lo spiega nel video https://www.youtube.com/watch?v=S4kd1IRSccY
Per le immagini lui mette il riferimento all'immaggine ed include anche l'immagine nel contesto in modo che quando lo esporti un agente AI possa analizzare anche l'immagine.
Inoltre dopo la coversione di una cartella o di un file fa in modo che si possa esporatre l'intera cartella in un zip o in un LLM wiki che poi l'agente deve leggere.
Io qui vogli fare diverso, oltre al download in formato LLM wiki che aggiunge una SKILL.md, voglio che questa applicazione di conversione sia anche:

- un mcp veloce che deve avere dei comandi per convertire immagini pdf in md ed al quale posso chiedere di aggiungere il file al mio dizionario wiki LLM.
- una extension pi con hook che quando carico un immagine si attiva con una richiesta all'utente per dire se usare l'ocr locae oppure no, poi mi deve chiedere se il documento contiene dati sensibili, se si deve fare l'anonimizzazione con j-pii quando lo usa nell'LLM.

In pratica vogli anche una applicazione per gestire i miei dizionari wiki LLM. che mi permetta di cercare, aggiungere, eliminare, modificare i dizionari. con la possibilità di esportare e importare i dizionari.
Anche questa applicazione deve essere accessibile via mcp dall'agente pi.

Ragioniamo insieme, suddividiamo il lavoro in WP. Cerchiamo di dare priorità alle cose più importanti. Facciamo indagini on-line per studiare i modelli da utilizzare.
Ipotizziamo il tutto come un sistema operativo modulare dove ogni pezzo si aggiunge o toglie.