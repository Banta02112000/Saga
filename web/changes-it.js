/* 0.7.8: the patch notes in Italian (What's new follows the app language). One entry per version, notes in the same order
   as CHANGES in app.js; a version missing here is shown in English with a note. */
(function () {
  window.SAGA_CHANGES_IT = {
    "0.7.9": [
      "Prompt da copiare e incollare per tutto (Impostazioni › Ricerca canon e AI): ogni passaggio AI (ricerca e controlli canon, multiversi, dettagli dei giochi, controllo canon dei giochi, aggiornamento di un titolo o di un universo, ordine di visione) ti mostra il prompt da incollare in una chat AI qualsiasi (Gemini, Claude, ChatGPT…) e legge la risposta che incolli. Nessuna chiave API necessaria.",
      "Quando una chiave API non funziona (chiave rotta, quota esaurita, Google che rifiuta), quel passaggio ora continua con copia e incolla invece di fermarsi, e dice perché. La scheda di copia e incolla funziona con qualsiasi chat AI, con pulsanti per Gemini, Claude e ChatGPT.",
      "Corretto: i dettagli dei giochi con copia e incolla rifiutavano le risposte che non erano una tabella."
    ],
    "0.7.8": [
      "In arrivo mostra solo le serie che stai guardando (stato In corso). Da guardare e le uscite canon hanno i loro filtri.",
      "Aggiorna tutto su ogni titolo, in ogni pagina: dettagli, voto, visto, episodi e il suo universo canon. Sui giochi controlla anche IMDb, la serie, i remake/remaster e i dettagli dall'AI.",
      "I giochi mostrano sempre l'originale, con remake, remaster e riedizioni elencati nella scheda, ognuno con il suo stato; toccane uno per aprirne la pagina. Se una versione è finita, tutto il gruppo conta come finito.",
      "Aggiorna questo universo (e ogni franchise dei giochi): l'AI controlla che i titoli presenti appartengano davvero all'universo e cerca quelli che mancano.",
      "La ricerca parte mentre scrivi, senza Invio. I link (IMDb, TMDB, negozi) compaiono solo quando esistono davvero per quel titolo.",
      "Doctor Who: con Doctor Who attivo nelle impostazioni, i romanzi della timeline vanno in Libri, i film in Guarda e i giochi in Giochi. Se spegni Doctor Who o togli una storia dalla timeline, quelli aggiunti così e non finiti escono di nuovo; quelli finiti restano. Audio, fumetti, racconti e webcast non hanno una sezione propria e restano nella timeline.",
      "Musica: le statistiche funzionano anche solo con Spotify (prima servivano gli scrobble di Last.fm); i riquadri vanno a capo invece di uscire dallo schermo.",
      "Meno scatti durante la sincronizzazione: il confronto con il sito è fatto a pezzi, in pausa tra uno e l'altro, invece che tutto in una volta.",
      "Nuovi temi (Vortice, Cinema, Synthwave, Foresta, Carta, Arcade), banner per i multiversi, locandine della stessa forma ovunque (tocca la locandina di un titolo per vederla intera) e una pagina Impostazioni del sito più ordinata (due colonne su uno schermo largo). Le note di versione seguono la lingua dell'app."
    ],
    "0.7.7": [
      "Giochi › Franchise segue le ricerche canon: ogni gioco che una ricerca ha messo in un franchise viene raggruppato lì, invece che in una serie indovinata dal suo titolo. Se tuoi giochi di quel franchise hanno un multiverso dalla tua lista, si usa il tuo nome; i giochi della tua lista restano come dice la lista. Si aggiorna ogni volta che cambiano il canon o i tuoi giochi."
    ],
    "0.7.6": [
      "Il canon di film e serie non porta più giochi: la ricerca AI elenca giochi solo per i franchise nati come videogiochi (giochi con una storia, ognuno una volta), e un universo di film o TV non mostra più i giochi tie-in (Doctor Who sì).",
      "Giochi › Mancanti esclude i tie-in di film o serie TV e, dopo il nuovo controllo canon con l'AI, i giochi non canon, senza campagna o storia, o che sono remake, remaster o riedizioni di un altro gioco (elencati sotto l'originale). Cosa ha escluso, e perché, è scritto in cima.",
      "Remake, remaster e riedizioni sono raggruppati con l'originale: un solo gioco, con tutte le versioni elencate e la data della versione più recente memorizzata. Le serie sono ordinate per quella data (Per versione più recente); Per uscita originale c'è ancora.",
      "Finire un gioco imposta come Prossimo il seguente della sua serie (per uscita originale, già uscito, non finito); se cambi di nuovo lo stato di quello finito, il Prossimo viene tolto. I giochi senza storia (un nuovo interruttore su ogni gioco) vengono saltati.",
      "I giochi seguono i multiversi importati: un gioco la cui serie era solo indovinata dal titolo entra nella serie e nel multiverso della tua lista quando il titolo comincia con quella serie, o quando è una versione di uno dei tuoi giochi.",
      "Aggiornamento notturno (Impostazioni › In background): verso le 3:30 il telefono fa una sincronizzazione completa (tutti i voti IMDb, non solo i più recenti), il sito, i lavori che Saga fa da sola e gli episodi di ogni serie. Sincronizza › Fatto da sé dice cosa ha fatto."
    ],
    "0.7.5": [
      "Tutto su entrambi: il sito ora può accedere a Spotify, IsThereAnyDeal e AniList (tornano a <il tuo sito>/oauth/…: aggiungi quell'indirizzo all'app che hai creato su ciascuno, accanto a quello del telefono; AniList ne accetta uno solo, lì usa Incolla l'indirizzo). Il sito prova anche a leggere da solo i tuoi voti IMDb (se IMDb lo rifiuta, li porta il telefono come prima), mostra notifiche mentre è aperto (nuovi episodi, avvisi di prezzo), riceve ciò che condividi una volta installato come app e mostra Fatto da sé (i lavori li fa il telefono, gli interruttori funzionano da entrambi).",
      "Anche il telefono ha la vista a due colonne del sito: su un Fold aperto o un tablet (da 880px) un titolo si apre accanto all'elenco."
    ],
    "0.7.4": [
      "Corretto: serie (e alcuni film e giochi) indicate come \"Da: IMDb visti\" che non avevi mai visto né votato. Quando il servizio dati di IMDb non rispondeva, Saga leggeva da sola la tua pagina dei voti, che elenca anche suggerimenti e altri titoli: quelli senza voto venivano salvati come visti. Ora da quella pagina si prendono solo i titoli con il tuo voto. Quelli aggiunti per errore vengono tolti una volta (solo se non li avevi votati, etichettati o annotati e non sono in nessun'altra tua lista o fonte), dopo averne fatto una copia; i titoli tolti non tornano con una sincronizzazione.",
      "\"Non mio: togli\" accanto alla riga Da su ogni film e serie (tocca due volte). Resta tolto: una sincronizzazione non lo riporta. Più titoli insieme: Libreria › Seleziona › Togli."
    ],
    "0.7.3": [
      "Salvataggio più leggero sul telefono: spuntare un episodio, votare o cambiare uno stato aggiunge una riga a un piccolo registro delle modifiche invece di riscrivere tutta la libreria (megabyte). Il file intero viene scritto quando esci dall'app, prima di una sincronizzazione con il sito e quando il registro diventa lungo; se il telefono chiude l'app nel frattempo, il registro viene riletto all'avvio successivo, quindi non si perde nulla.",
      "Il controllo giornaliero di IMDb ora gira sul tuo sito (il Pi): IMDb rifiuta i server di GitHub. Se scopre che IMDb ha cambiato qualcosa che Saga legge, la Home del telefono lo dice; la pagina del proprietario del sito mostra l'ultimo risultato.",
      "Fatto da sé: una volta a settimana la copia automatica più recente dei tuoi dati viene aperta e confrontata con quello che hai; una copia rotta o incompleta viene sostituita subito."
    ],
    "0.7.2": [
      "Saga ora fa da sola i piccoli lavori che prima avviavi a mano, dopo ogni sincronizzazione (e all'apertura dell'app), e li annota uno per uno (Sincronizza › Fatto da sé, dove ognuno si può spegnere): una parte fallita perché IMDb o la connessione l'hanno rifiutata viene ritentata 45 minuti dopo (3 volte al giorno); i giochi canon che hai votato o messo in lista su IMDb escono da Giochi › Mancanti (Finito con il tuo voto, o Desiderati); i nuovi giochi ricevono i dettagli dal tuo prompt (solo con chiave API Gemini); film e serie ricevono durata e cast; i doppioni esatti (stesso id IMDb, TMDB o Steam) vengono uniti, dopo averne fatto una copia.",
      "Sito offline: le modifiche fatte mentre non raggiungeva il Pi vengono unite rispetto alla versione da cui erano partite, così non possono annullare nulla di ciò che il telefono ha inviato nel frattempo (anche se il Pi si è riavviato)."
    ],
    "0.7.1": [
      "La ricerca trova anche le persone: tutto il cast, e chi ha diretto o creato ciò che hai in libreria, con quello che hai visto di loro; anche gli episodi per nome, e la tua musica (artisti e brani).",
      "Home: Cosa dopo. Un'unica coda tra serie, canon, giochi, libri e Doctor Who, ordinata per quello che hai fatto per ultimo, così ciò che hai a metà viene prima. C'è anche il prossimo film o serie di ogni franchise che hai iniziato.",
      "Il riepilogo dell'anno conta anche il tempo di ascolto (dai tuoi scrobble) e ha un Meglio dell'anno: il film, la serie, il gioco e il libro con il voto più alto di quell'anno, e il tuo artista più ascoltato.",
      "Su uno schermo grande (il sito su un computer) un titolo si apre accanto all'elenco, che resta usabile: tocca un altro titolo per cambiare, × o Esc chiude. Tasti: / cerca, h l u c g b d m s vanno a una sezione, ? li elenca.",
      "Il sito funziona offline: si apre da una copia dei tuoi dati tenuta in quel browser, conserva le tue modifiche e le invia quando raggiunge di nuovo il Pi (unite a ciò che il telefono ha inviato nel frattempo).",
      "I problemi con IMDb dicono in una frase cosa è successo davvero: IMDb ha cambiato qualcosa, vuole che tu abbia fatto l'accesso, sta rifiutando le richieste per ora, o non era raggiungibile. Tutto il resto continua a sincronizzarsi, l'esportazione CSV viene tentata da sola e GitHub controlla IMDb ogni mattina e apre una segnalazione se è cambiato.",
      "Giochi › Mancanti: Controlla su IMDb. Ogni gioco canon mancante viene cercato nei tuoi voti e nelle tue liste IMDb: votato lì significa finito, con il tuo voto; in una lista significa desiderato. Gli altri ricevono il voto di IMDb sulla loro riga (o \"non su IMDb\").",
      "I dettagli dei giochi dall'AI usano il tuo prompt parola per parola, un gioco per domanda, e Saga legge la risposta comunque sia impaginata. La risposta resta con il gioco (Dettagli › Risposta dell'AI al tuo prompt); vengono riempiti solo i campi vuoti.",
      "Dietro le quinte: grandi parti dell'app (sincronizzazione con il sito, offerte, copie, doppioni, liste intelligenti, Per te) sono state spostate in file propri, così una modifica in una parte non può rompere per sbaglio un'altra."
    ],
    "0.7.0": [
      "La sincronizzazione con il sito invia solo ciò che è cambiato: un voto, un episodio spuntato, un gioco, invece di file interi. Più veloce, e telefono e sito non si pestano più i piedi. La prima sincronizzazione dopo l'aggiornamento invia tutto una volta, come prima; prima viene fatta una copia dei tuoi dati. Se dopo una sincronizzazione i due non coincidono, Saga confronta l'intero file e lo annota nel registro errori.",
      "Cronologia delle modifiche (Impostazioni › Account e sincronizzazione): ogni modifica vista dal tuo sito, dal telefono o dal sito, dalla più recente, con cosa è cambiato (voto 4 → 5…) e un Annulla per ognuna. Conservata da questa versione in poi.",
      "Il sito resta al passo con il telefono: si aggiorna da solo ogni 6 ore (attivato da update.sh, a meno che tu non l'abbia spento) e, quando ha una versione di Saga più vecchia del telefono, lo dice in ogni schermata, non salva modifiche ai tuoi dati e si aggiorna se può."
    ]
  };
})();
