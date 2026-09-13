Leggi l'applicazione sviluppata in questa cartella ed il progetto rizzo-pii.

Usando wayfinder voglio riprogettare l'intera soluzione e renderla efficiente, usabile e production ready.
In particolare ho in mente questo:
1) L'UI deve sempre proporre a sinistra l'elemento originale derivato da quello che si è cliccato dall'albero dei file. Deve essere una spece di editor viewer con compare come in VS Code. Per la corrispondenza file originale e file md convertito deve esserci da qualche parte, probabilmente nel wiki stesso il riferimento in modo che tu puoi mostrarli sempre accoppiati.
2) A destra propone l'elemento corretto da sostituire evidenziando anche i dati sensibili come fa rizzo-pii. 
Gli elementi a destra devono essere modificabili.
3) L'iterazione con l'agente pi deve essere veloce performante e sempre funzionante conoscere il contesto in cui opera il wiki. 
4) Probabilmente è più utile avere una finestra di popup per l'agente pi.
5) ATTENZIONE tutto il progetto si basa sul principio che i file immagini pdf sono trattati in locale, quindi il pi non deve assolutamnete accedere ai file originali ma solo agli md ricavati e quelli ricavati devono essere codificati con rizzo-pi usando la specifica estensione.
6) Tutta la logica di rizzo-pii deve essere mantenuta è fondamentale, l'interazione con gli script pi deve essere preservata, la logica di rizzo-pii deve essere potenziata con le nuove indicaioni ed integrata nell'applicazione
7) Dobbiamo costruire una spece di log delle cose che vanno all'LLM in modo che chi usa l'applicativo LLM in una sessione deve sapere cosa viene inviato all'LLM. Eventuali dati personoali non dovrebbero andare, se scappa qualcosa dovrebbe riconoscerlo con un alert e chiedere di passare a usare j-pii estensione pi. Questo punto dovrebbe essere già coperto.
8) devi fare una indagine nel web e di progetti opensource per vedre se eiste qualcosa simile a questa che stiamo implementando allo scopo di migliorarlo.
9) Dobbiamo migliorare l'applicazione, ad esempio introducendo un menù principale e la voce setting. Attenzione questo è un punto cruciale dobbiamo iterare e sperimentare fino a raggiungere un livello di usabilità notevole.
10) L'applicazione deve avere una cartella di lavoro sempre, quindi se non è configurata deve guidare l'utente.
11) Ad ogni piccolo intervento di modifica dell'applicativo web devi fare i test con playwright, e devi consegnarni l'applicazione funzionante. Non voglio perdere tempo a testare cose ovvie. Quindi costruisciti dei test playwright fissi che poi riutilizzerai. Introduci anche una logica di hepler typescript con annotazione dei nodi di navigazione o qualcosa di simile in modo che gli script sono utilizzabili e navigabili facilmente se aggiungi o modifichi qualcosa.
13) Crea anche un piano di lavoro priotizzando alcuni di questi task ed organizzandoli.
14) se ti viene in mente qualcosa in più per migliorare l'applicazione suggeriscimelo subito così lo aggiungiamo al piano.