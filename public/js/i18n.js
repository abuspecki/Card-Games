/* =========================================================
   CardGames — German / English.
   The site is written in English; in German mode this layer translates
   every visible text (and placeholders, titles, labels) as it appears,
   including texts the tables draw on every update. Player names, chat
   and anything marked [data-no-i18n] are left alone.
   Language: saved per device (cg.lang); default = the browser language.
   ========================================================= */
(function () {
  const KEY = 'cg.lang';
  const lang = () => localStorage.getItem(KEY) || ((navigator.language || 'en').toLowerCase().startsWith('de') ? 'de' : 'en');

  // ---------- exact phrases ----------
  const DE = {
    // navigation & lobby
    'Games': 'Spiele', 'Shop': 'Shop', 'Bank': 'Bank', 'Ranks': 'Rangliste', 'Friends': 'Freunde', '♛ Owner': '♛ Owner',
    'Sign in': 'Anmelden', 'Join free': 'Kostenlos beitreten', 'Join': 'Beitreten', 'How to play': 'Spielregeln', 'Feedback': 'Feedback',
    '📲 Install the app': '📲 App installieren', '♛ Owner dashboard': '♛ Owner-Bereich', 'Owner dashboard': 'Owner-Bereich',
    'Appearance': 'Darstellung', 'Light': 'Hell', 'Dark': 'Dunkel', 'Automatic': 'Automatisch', 'Language': 'Sprache',
    'Card games with your friends': 'Kartenspiele mit deinen Freunden',
    'Poker, Blackjack, Durak, Roulette and Flamingo — free, with play money.': 'Poker, Blackjack, Durak, Roulette und Flamingo – kostenlos, mit Spielgeld.',
    'Play as guest': 'Als Gast spielen', 'Leaderboard': 'Bestenliste', 'Full ranking': 'Ganze Rangliste',
    'Chips won — poker only counts hands against real people, no bots.': 'Gewonnene Chips – bei Poker zählen nur Hände gegen echte Mitspieler, keine Bots.',
    'Play money only.': 'Nur Spielgeld.', 'Me': 'Ich', 'All': 'Alle', 'Poker': 'Poker',
    'Tables open — be the first': 'Tische offen – sei der Erste',
    'No-Limit poker · up to 8 players': 'No-Limit-Poker · bis 8 Spieler', 'Beat the dealer to 21': 'Schlag den Dealer bis 21',
    "Attack, defend — don't be the fool": 'Angreifen, verteidigen – sei nicht der Durak', 'Red, black or your lucky number': 'Rot, Schwarz oder deine Glückszahl',
    'Match colour or number · up to 6': 'Farbe oder Zahl bedienen · bis 6', 'Dig deeper — cash out before it caves in': 'Grab tiefer – zahl aus, bevor es einstürzt',
    'The Mine': 'Die Mine', 'Solo': 'Solo', 'Stakes 10 – 5,000 · members': 'Einsatz 10 – 5.000 · Mitglieder', 'Play': 'Spielen',
    'Table 1': 'Tisch 1', 'High Roller': 'High Roller', 'Empty': 'Leer', 'Waiting': 'Wartet', '● In play': '● Im Spiel',
    'Take a Seat': 'Platz nehmen', 'Take a seat': 'Platz nehmen', 'Table full': 'Tisch voll', 'Members only': 'Nur Mitglieder', 'Not enough chips': 'Zu wenig Chips',
    '👁 Watch': '👁 Zuschauen', 'Watch this table without taking a seat': 'Diesem Tisch zuschauen, ohne Platz zu nehmen', 'Open seat': 'Freier Platz',
    '2–6 players': '2–6 Spieler', 'members only': 'nur Mitglieder',
    // member bar
    'Good morning': 'Guten Morgen', 'Good afternoon': 'Guten Tag', 'Good evening': 'Guten Abend', 'Good night': 'Gute Nacht',
    'Chips': 'Chips', 'Coins': 'Münzen', 'Friends online': 'Freunde online', 'Quick seat': 'Schnell spielen', 'Return': 'Zurück zum Tisch',
    'Leave the table': 'Tisch verlassen', 'Your seat is free again.': 'Dein Platz ist wieder frei.',
    // tab names, windows
    'Wallet': 'Konto', 'The Shop': 'Shop', 'My Profile': 'Mein Profil', 'Profile': 'Profil', 'Signing out leaves the table — a hand is running, what you have bet is lost. Sign out anyway?': 'Beim Abmelden verlässt du den Tisch – es läuft eine Hand, dein Einsatz ist dann verloren. Trotzdem abmelden?', 'Sign out': 'Abmelden', 'Close': 'Schließen', 'Cancel': 'Abbrechen',
    'Got it': 'Verstanden', 'Loading…': 'Lädt…', 'Something went wrong': 'Etwas ist schiefgelaufen', 'Network problem — please try again': 'Verbindungsproblem – bitte nochmal versuchen',
    // sign in
    'Members': 'Mitglieder', 'Welcome back': 'Willkommen zurück', 'Become a member': 'Mitglied werden', 'Create my membership': 'Konto erstellen',
    'Username': 'Benutzername', 'Password': 'Passwort', 'Your name': 'Dein Name', 'Take my seat as a guest': 'Als Gast Platz nehmen',
    'Sign in or become a member': 'Anmelden oder Mitglied werden', 'Forgotten your details? Send us a note via Feedback.': 'Zugangsdaten vergessen? Schreib uns über Feedback.',
    'Forgotten your password? Send the owner a note via Feedback with your name — you will get a temporary password.': 'Passwort vergessen? Schreib dem Owner über Feedback mit deinem Namen – du bekommst ein vorläufiges Passwort.',
    'Your account': 'Dein Konto', 'Choose a new password': 'Wähle ein neues Passwort', 'Change your password': 'Passwort ändern', 'Change password': 'Passwort ändern',
    'You signed in with a temporary password. Please choose your own now — only you will know it.': 'Du hast dich mit einem vorläufigen Passwort angemeldet. Bitte wähle jetzt dein eigenes – nur du kennst es dann.',
    'Current password': 'Aktuelles Passwort', 'New password': 'Neues Passwort', 'Repeat the new password': 'Neues Passwort wiederholen',
    'Save my new password': 'Neues Passwort speichern', 'At least 6 characters. Other devices will be signed out.': 'Mindestens 6 Zeichen. Andere Geräte werden abgemeldet.',
    'The two new passwords are not the same': 'Die beiden neuen Passwörter sind nicht gleich', 'Your new password is saved.': 'Dein neues Passwort ist gespeichert.',
    'Your current password is not right': 'Dein aktuelles Passwort stimmt nicht', 'The new password needs at least 6 characters': 'Das neue Passwort braucht mindestens 6 Zeichen',
    'Please choose a password different from the old one': 'Bitte wähle ein anderes Passwort als das alte',
    'Guests play with free table chips. Members keep their winnings, collect coins and appear on the leaderboard.': 'Gäste spielen mit kostenlosen Tisch-Chips. Mitglieder behalten ihre Gewinne, sammeln Münzen und stehen in der Bestenliste.',
    'You have signed out. Do come again.': 'Du bist abgemeldet. Bis bald!',
    'Members receive 5,000 chips and 200 coins, keep their winnings and appear on the leaderboard. 3–16 characters (letters incl. ä ö ü, numbers, spaces); password of 6+ characters.':
      'Mitglieder bekommen 5.000 Chips und 200 Münzen, behalten ihre Gewinne und stehen in der Bestenliste. Name: 3–16 Zeichen (Buchstaben inkl. ä ö ü, Zahlen, Leerzeichen); Passwort ab 6 Zeichen.',
    'Wrong username or password': 'Falscher Benutzername oder falsches Passwort', 'Password must be at least 6 characters': 'Das Passwort braucht mindestens 6 Zeichen',
    'Your name needs 3–16 characters': 'Dein Name braucht 3–16 Zeichen', 'Use letters (ä, ö, ü are fine), numbers, spaces, _ - or . in your name': 'Nutze Buchstaben (ä, ö, ü gehen), Zahlen, Leerzeichen, _ - oder . im Namen',
    // wallet & bank
    'Chips are play money.': 'Chips sind Spielgeld.', 'Coins are rewards.': 'Münzen sind Belohnungen.', 'The Bank trades both ways': 'Die Bank tauscht in beide Richtungen',
    'Bankroll': 'Konto', 'chips to play with': 'Chips zum Spielen', 'At the tables': 'An den Tischen', 'returns when you leave': 'kommt beim Verlassen zurück',
    'for the shop': 'für den Shop', 'The Daily Bonus': 'Täglicher Bonus', 'The Bank': 'Die Bank', 'Visit the Bank': 'Zur Bank', 'The Daily Top-up': 'Tägliches Auffüllen',
    'Coins from the tables': 'Münzen von den Tischen', 'Visit every day for a growing gift of coins — up to 250 on the seventh day in a row.': 'Komm jeden Tag vorbei – das Geschenk wächst bis 250 Münzen am siebten Tag in Folge.',
    'Your chips': 'Deine Chips', 'Your coins': 'Deine Münzen', 'Chips → Coins': 'Chips → Münzen', 'Coins → Chips': 'Münzen → Chips', 'Coins to receive': 'Münzen erhalten',
    'Coins to trade': 'Münzen tauschen', 'You pay': 'Du zahlst', 'You receive': 'Du bekommst', 'chips': 'Chips', 'Exchange chips for coins': 'Chips in Münzen tauschen',
    'Exchange coins for chips': 'Münzen in Chips tauschen', 'You have no coins to trade yet — collect the daily bonus or win at the tables.': 'Du hast noch keine Münzen – hol dir den Tagesbonus oder gewinn an den Tischen.',
    'Play money only — nothing here can be bought with or exchanged for real money.': 'Nur Spielgeld – nichts hier kann mit echtem Geld gekauft oder dagegen getauscht werden.',
    'Daily bonus': 'Tagesbonus', 'Check / Fold': 'Schieben / Passen', 'Call any': 'Alles mitgehen', 'What would have come': 'Das wäre noch gekommen', 'Your statement': 'Dein Kontoauszug', 'Win at': 'Gewinn bei', 'Daily top-up': 'Tägliches Auffüllen',
    'Bank: chips → coins': 'Bank: Chips → Münzen', 'Bank: coins → chips': 'Bank: Münzen → Chips', 'Shop:': 'Shop:', 'Quest:': 'Aufgabe:', 'Achievement:': 'Erfolg:',
    'Sit & Go prize': 'Sit-&-Go-Preis', 'Gift from the house': 'Geschenk vom Haus', 'Thank-you bonus for an update': 'Dankeschön-Bonus für ein Update',
    'Correction by the owner': 'Korrektur durch den Owner', 'The statement could not be loaded.': 'Der Kontoauszug konnte nicht geladen werden.',
    'No bookings yet — collect the daily bonus or win a hand.': 'Noch keine Buchungen – hol dir den Tagesbonus oder gewinn eine Hand.',
    'Every coin and chip booking with its reason — the newest first. Chips you take to a table and back are not listed.': 'Jede Buchung von Münzen und Chips mit Grund – die neueste zuerst. Chips, die du an einen Tisch mitnimmst und zurückbekommst, stehen hier nicht.', 'Your daily top-up': 'Dein tägliches Auffüllen', 'Your coins:': 'Deine Münzen:',
    'The Bank is for members — sign in to exchange chips and coins.': 'Die Bank ist für Mitglieder – melde dich an, um Chips und Münzen zu tauschen.',
    // shop
    'Card backs': 'Kartenrücken', 'Card faces': 'Kartenseiten', 'Table felt': 'Tischfilz', 'Chip sets': 'Chip-Sets', 'Backgrounds': 'Hintergründe', 'Portraits': 'Porträts',
    'Titles': 'Titel', 'Turn markers': 'Zug-Markierung', 'Gestures': 'Gesten', 'Free': 'Gratis', 'Use': 'Benutzen', 'In use': 'Aktiv', 'Purchase': 'Kaufen', 'Use at the table': 'Am Tisch benutzen',
    'The back of every face-down card — on your screen.': 'Die Rückseite jeder verdeckten Karte – auf deinem Bildschirm.',
    'How the faces of the cards are printed — on your screen.': 'Wie die Karten bedruckt sind – auf deinem Bildschirm.',
    'The cloth of every table you sit at — on your screen.': 'Der Bezug jedes Tisches, an dem du sitzt – auf deinem Bildschirm.',
    'The wallpaper of the club and the rooms — on your screen.': 'Die Tapete von Club und Räumen – auf deinem Bildschirm.', 'The chips on every table — on your screen.': 'Die Chips auf jedem Tisch – auf deinem Bildschirm.',
    'How the player whose turn it is gets marked — on your screen.': 'Wie der Spieler am Zug markiert wird – auf deinem Bildschirm.',
    // friends & profile
    'Requests for you': 'Anfragen an dich', 'Accept': 'Annehmen', 'Decline': 'Ablehnen', 'Your friends': 'Deine Freunde', 'Invite': 'Einladen', 'Remove': 'Entfernen',
    'Waiting for an answer': 'Wartet auf Antwort', 'None of your friends are online right now.': 'Gerade ist keiner deiner Freunde online.', 'Send request': 'Anfrage senden',
    'Add a friend by username': 'Freund per Benutzername hinzufügen', 'Members can invite friends to the table.': 'Mitglieder können Freunde an den Tisch einladen.',
    'Player not found': 'Spieler nicht gefunden', 'Member profile': 'Mitgliederprofil', 'Add as friend': 'Als Freund hinzufügen', 'Friend request sent.': 'Freundschaftsanfrage gesendet.',
    'Accept friend request': 'Freundschaftsanfrage annehmen', 'Invite to my table': 'An meinen Tisch einladen', 'No hands played yet.': 'Noch keine Hände gespielt.',
    'Game': 'Spiel', 'Hands': 'Hände', 'Won': 'Gewonnen', 'Member': 'Mitglied', 'Result': 'Ergebnis', 'Points': 'Punkte', 'Chips won': 'Gewonnene Chips',
    // leaderboard / feedback
    'The Club Ledger': 'Die Rangliste', 'Could not load the leaderboard.': 'Die Bestenliste konnte nicht geladen werden.',
    'No results yet — the first winner takes the top spot.': 'Noch keine Ergebnisse – der erste Gewinner holt Platz 1.', 'No results yet. The first member to play takes the top spot.': 'Noch keine Ergebnisse. Wer zuerst spielt, holt Platz 1.',
    'Blackjack hands against the dealer. Ranked by chips won.': 'Blackjack-Hände gegen den Dealer. Nach gewonnenen Chips.', 'Roulette spins. Ranked by chips won.': 'Roulette-Runden. Nach gewonnenen Chips.',
    'Gold Rush digs. Ranked by chips won.': 'Gold-Rush-Grabungen. Nach gewonnenen Chips.', 'Flamingo: +1 point for every game you win.': 'Flamingo: +1 Punkt pro gewonnenem Spiel.',
    'Durak: +1 point for escaping, −1 for being the durak.': 'Durak: +1 Punkt fürs Rauskommen, −1 als Durak.', "Hold'em hands played against the house's bots.": "Hold'em-Hände gegen die Bots des Hauses.",
    "Hold'em hands with at least two people. Ranked by total chips won — losses count.": "Hold'em-Hände mit mindestens zwei Menschen. Nach gewonnenen Chips – Verluste zählen mit.",
    'vs Bots': 'gegen Bots', 'Correspondence': 'Feedback', 'Category': 'Kategorie', 'Bug report': 'Fehler melden', 'Suggestion': 'Vorschlag', 'Feature request': 'Neue Funktion',
    'General feedback': 'Allgemein', 'Your message': 'Deine Nachricht', 'Send to the house': 'Absenden', 'Thank you': 'Danke',
    'Found a bug, have an idea or simply a remark? Every note is read by the house.': 'Fehler gefunden, eine Idee oder einfach eine Anmerkung? Wir lesen jede Nachricht.',
    'Your note has been delivered to the house. We read every one.': 'Deine Nachricht ist angekommen. Wir lesen jede einzelne.',
    'Please write a little more (at least 5 characters)': 'Bitte schreib etwas mehr (mindestens 5 Zeichen)',
    // rules dialog
    'The House Rules': 'Spielregeln', 'The hands, from best to worst': 'Die Hände, von der besten zur schlechtesten',
    'Royal Flush': 'Royal Flush', 'Straight Flush': 'Straight Flush', 'Four of a Kind': 'Vierling', 'Full House': 'Full House', 'Flush': 'Flush', 'Straight': 'Straße',
    'Three of a Kind': 'Drilling', 'Two Pair': 'Zwei Paare', 'Pair': 'Paar', 'High Card': 'Höchste Karte',
    'Five in a row, one suit.': 'Fünf in Folge, eine Farbe.', 'Four of one rank.': 'Vier gleiche Werte.', 'Three of a kind and a pair.': 'Drilling und Paar.',
    'Five of one suit.': 'Fünf einer Farbe.', 'Five in a row.': 'Fünf in Folge.', 'Three of one rank.': 'Drei gleiche Werte.', 'Two different pairs.': 'Zwei verschiedene Paare.',
    'Two of one rank.': 'Zwei gleiche Werte.', 'Nothing else — your highest card plays.': 'Nichts davon – deine höchste Karte zählt.', 'A, K, Q, J, 10 of one suit.': 'A, K, D, B, 10 einer Farbe.',
    // table chrome
    'Lobby': 'Lobby', 'Guest': 'Gast', 'Chat': 'Chat', 'Log': 'Verlauf', 'Odds': 'Chancen', 'Table': 'Tisch', 'Send': 'Senden', 'Company': 'Mitspieler',
    'Invite a bot': 'Bot einladen', 'Dismiss a bot': 'Bot entfernen', 'Invite a friend': 'Freund einladen', 'Copy table link': 'Tischlink kopieren', 'House': 'Haus',
    'Report a problem': 'Problem melden', 'Sound': 'Ton', 'Sound on': 'Ton an', 'Sound off': 'Ton aus', 'Say something…': 'Schreib etwas…',
    'No messages yet. Say good evening.': 'Noch keine Nachrichten. Sag Hallo!', 'Table link copied — send it to a friend.': 'Tischlink kopiert – schick ihn einem Freund.',
    'Your chips come from your bankroll and return to it when you leave.': 'Deine Chips kommen von deinem Konto und gehen beim Verlassen dorthin zurück.',
    'As a guest you play with free table chips.': 'Als Gast spielst du mit kostenlosen Tisch-Chips.',
    'Your chances appear here while you play a hand.': 'Hier erscheinen deine Chancen, während du eine Hand spielst.', 'Calculating…': 'Berechne…', 'By the river': 'Bis zum River',
    "An estimate against random hands. Nobody's cards are peeked.": 'Eine Schätzung gegen zufällige Hände. Niemandes Karten werden angeschaut.',
    'Advice appears on your turn.': 'Tipps erscheinen, wenn du dran bist.', 'You hold': 'Du hast', 'chance to bust if you hit': 'Chance, mit einer Karte über 21 zu kommen',
    'The book says:': 'Die Strategie sagt:', 'Based on basic strategy — the mathematically soundest play.': 'Nach der Grundstrategie – der mathematisch besten Spielweise.',
    'The odds favour a call.': 'Die Chancen sprechen fürs Mitgehen.', 'The price is steep.': 'Der Preis ist hoch.',
    'Connection lost — reconnecting…': 'Verbindung verloren – verbinde neu…', 'Daily table limit reached': 'Tageslimit am Tisch erreicht', 'For your win': 'Für deinen Gewinn',
    'Leave in the middle of a game? You will be the durak.': 'Mitten im Spiel gehen? Dann bist du der Durak.', 'Leave in the middle of a game? You give up this round.': 'Mitten im Spiel gehen? Du gibst diese Runde auf.',
    'Leave in the middle of a hand? You lose what you have bet.': 'Mitten in der Hand gehen? Dein Einsatz ist dann weg.',
    // quick chat
    'Good luck all!': 'Viel Glück allen!', 'Nice hand!': 'Schöne Hand!', 'Well played': 'Gut gespielt', 'Unlucky…': 'Pech…', 'Your turn 🙂': 'Du bist dran 🙂',
    'One more round?': 'Noch eine Runde?', 'Thanks!': 'Danke!', 'Gestures are for members.': 'Gesten gibt es für Mitglieder.', 'Get gestures in the Shop': 'Gesten im Shop holen',
    // hold'em
    'Min': 'Min', '½ Pot': '½ Pot', '¾ Pot': '¾ Pot', 'Pot': 'Pot', 'All-in': 'All-in', 'Fold': 'Passen', 'Check': 'Schieben', 'Raise': 'Erhöhen', 'Rebuy': 'Nachkaufen',
    'POT': 'POT', 'Out of chips': 'Keine Chips', 'Folded': 'Gepasst', 'Waiting for another player — invite a friend or a bot': 'Warte auf Mitspieler – lade einen Freund oder Bot ein',
    'The next hand is about to be dealt…': 'Gleich wird die nächste Hand ausgeteilt…', 'Your move.': 'Du bist dran.', 'You folded — wait for the next hand.': 'Du hast gepasst – warte auf die nächste Hand.',
    'You are dealt in from the next hand.': 'Du spielst ab der nächsten Hand mit.', 'You are out of chips at this table. Rebuy from your bankroll.': 'Du hast an diesem Tisch keine Chips mehr. Kauf vom Konto nach.',
    'You are out of chips. Rebuy for a fresh stack.': 'Du hast keine Chips mehr. Kauf einen neuen Stapel nach.',
    // blackjack
    'Your hand': 'Deine Hand', 'Your bet': 'Dein Einsatz', 'Hit': 'Karte', 'Draw a card': 'Karte ziehen', 'Stand': 'Halten', 'Keep your hand': 'Hand behalten',
    'Double': 'Verdoppeln', 'Double & one card': 'Verdoppeln & eine Karte', 'Split': 'Teilen', 'Pairs only': 'Nur Paare', 'Clear': 'Löschen', 'Remove bet': 'Einsatz weg',
    'Deal': 'Austeilen', 'Place your bet': 'Setz deinen Einsatz', 'A fresh stack': 'Neuer Stapel', 'Repeat': 'Wiederholen', 'Blackjack pays 3 to 2': 'Blackjack zahlt 3 zu 2',
    'Dealer must draw to 16 and stand on all 17s': 'Der Dealer zieht bis 16 und bleibt ab 17 stehen', 'Dealer has Blackjack': 'Der Dealer hat Blackjack',
    'Win': 'Gewinn', 'Lose': 'Verlust', 'Push': 'Unentschieden', 'Take a breath — the next round begins shortly': 'Kurz durchatmen – gleich geht die nächste Runde los',
    'Out of chips — rebuy to keep playing.': 'Keine Chips mehr – kauf nach, um weiterzuspielen.', 'Add chips, then deal.': 'Chips setzen, dann austeilen.',
    'The house takes this one.': 'Diese Runde geht ans Haus.', 'A fine moment to double.': 'Ein guter Moment zum Verdoppeln.',
    // durak
    'Choose a card': 'Wähle eine Karte', 'Pass': 'Passen', 'TRUMP': 'TRUMPF', 'Spades': 'Pik', 'Hearts': 'Herz', 'Diamonds': 'Karo', 'Clubs': 'Kreuz',
    'Watching': 'Schaut zu', 'Out of cards': 'Keine Karten mehr', 'Defending': 'Verteidigt', 'Attacking': 'Greift an', 'May add cards': 'Darf zulegen', 'Deck empty': 'Stapel leer',
    'Beat this card': 'Schlag diese Karte', 'You are out of cards — safe! 🎉': 'Keine Karten mehr – du bist raus! 🎉', 'The cards are being shuffled…': 'Die Karten werden gemischt…',
    'Your attack — play any card.': 'Dein Angriff – spiel eine beliebige Karte.', 'You may add cards of a rank already on the table.': 'Du darfst Karten mit einem Wert zulegen, der schon liegt.',
    'Tap a card to select it, tap again to play.': 'Tippe eine Karte zum Auswählen, nochmal zum Spielen.', 'Tap a glowing card to select it.': 'Tippe eine leuchtende Karte an.',
    'Waiting…': 'Warte…', 'Waiting for the deal': 'Warte aufs Austeilen', 'Done adding': 'Fertig mit Zulegen', 'Wait for your turn.': 'Warte, bis du dran bist.',
    'A draw — nobody is the durak!': 'Unentschieden – niemand ist der Durak!',
    // roulette
    'Your bets': 'Deine Einsätze', 'Undo': 'Zurück', 'Spin': 'Drehen', 'The wheel awaits its first spin': 'Das Rad wartet auf die erste Runde', 'Place your bets': 'Einsätze bitte',
    'No more bets': 'Nichts geht mehr', 'Even': 'Gerade', 'Odd': 'Ungerade', 'Red': 'Rot', 'Black': 'Schwarz', 'No more bets — the wheel is spinning': 'Nichts geht mehr – das Rad dreht sich',
    'The house takes this one': 'Diese Runde geht ans Haus', 'Next spin shortly': 'Gleich nächste Runde', 'The croupier is ready': 'Der Croupier ist bereit',
    'red': 'Rot', 'black': 'Schwarz', 'zero': 'Null', 'Column 1': 'Kolonne 1', 'Column 2': 'Kolonne 2', 'Column 3': 'Kolonne 3',
    // flamingo
    'COLOUR': 'FARBE', 'Cherry': 'Kirsche', 'Violet': 'Violett', 'Sun': 'Sonne', 'Teal': 'Türkis', 'Skip': 'Aussetzen', 'Reverse': 'Richtungswechsel', 'Draw Two': '+2',
    'Wild': 'Farbwahl', 'Wild +4': 'Farbwahl +4', 'Winner!': 'Gewonnen!', 'Playing…': 'Spielt…', 'Last card!': 'Letzte Karte!', 'Shuffling the pink deck…': 'Der rosa Stapel wird gemischt…',
    'Flamingo! You are out of cards and win 🦩': 'Flamingo! Du hast keine Karten mehr und gewinnst 🦩', 'No luck — pass.': 'Kein Glück – passen.', 'Nothing fits — draw a card.': 'Nichts passt – zieh eine Karte.',
    'Draw a card ': 'Karte ziehen', 'Tap a glowing card.': 'Tippe eine leuchtende Karte an.', 'Pick the next colour:': 'Wähle die nächste Farbe:',
    // gold rush
    'Gold Rush': 'Gold Rush', 'Solo game': 'Einzelspiel', 'Risk per tunnel': 'Risiko pro Stollen', 'Surface': 'Oberfläche', 'Stake': 'Einsatz', 'Now': 'Jetzt', 'Cash-out': 'Auszahlung',
    'Max': 'Max', 'Start digging': 'Losgraben', 'Take my stake back': 'Einsatz zurücknehmen', 'Easy': 'Leicht', 'Medium': 'Mittel', 'Hard': 'Schwer', 'Extreme': 'Extrem',
    'Each tunnel raises the multiplier — and may cave in. Cash out whenever you like. Play money only.': 'Jeder Stollen erhöht den Multiplikator – und kann einstürzen. Zahl aus, wann du willst. Nur Spielgeld.',
    'Gold Rush is played with your own chips — create a free account (5,000 chips).': 'Gold Rush spielst du mit deinen eigenen Chips – erstell ein kostenloses Konto (5.000 Chips).',
    'Gold Rush is not available': 'Gold Rush ist gerade nicht verfügbar', 'Finish your current dig first': 'Beende erst deine laufende Grabung',
    // install & update
    'App': 'App', 'Install CardGames': 'CardGames installieren', 'CardGames is now on your home screen.': 'CardGames ist jetzt auf deinem Homescreen.', 'You are already using the app.': 'Du nutzt bereits die App.',
    '🔧 Short update break · chips are safe': '🔧 Kurze Update-Pause · Chips sind sicher', '🔧 Updating — back in a moment, chips are safe': '🔧 Update läuft – gleich zurück, Chips sind sicher',
    // misc server messages
    'Too many failed attempts. Try again in a few minutes.': 'Zu viele Fehlversuche. Versuch es in ein paar Minuten nochmal.',
    "This table is full — try the other one": 'Dieser Tisch ist voll – versuch den anderen', 'Only the owner can watch tables': 'Nur der Owner kann zuschauen',
    'Not your turn': 'Du bist nicht dran', 'Not enough chips to repeat': 'Zu wenig Chips zum Wiederholen', 'Not enough chips to double': 'Zu wenig Chips zum Verdoppeln',
    'Place a bet first': 'Setz zuerst einen Einsatz', 'Nothing to repeat yet': 'Noch nichts zum Wiederholen', 'You still have chips — the refill is for players with fewer than 100': 'Du hast noch Chips',
    'Nothing to cash out': 'Nichts zum Auszahlen', 'Start a new dig first': 'Starte zuerst eine neue Grabung', 'Pick a level': 'Wähle eine Stufe',
  };

  Object.assign(DE, {
    // headings split around a highlighted word
    'Become a': 'Mitglied', 'member': 'werden', 'Good morning,': 'Guten Morgen,', 'Good afternoon,': 'Guten Tag,', 'Good evening,': 'Guten Abend,', 'Good night,': 'Gute Nacht,',
    'The': 'Die', 'in your bankroll': 'auf deinem Konto',
    'Turn chips into coins for the shop: 110 chips per coin (100 + the 10 % fee).': 'Tausch Chips in Münzen für den Shop: 110 Chips pro Münze (100 + 10 % Gebühr).',
    'Short of chips? Trade coins back into chips: 90 chips per coin (100 − the 10 % fee).': 'Zu wenig Chips? Tausch Münzen zurück: 90 Chips pro Münze (100 − 10 % Gebühr).',
    'Up to 1,000 coins per exchange.': 'Bis zu 1.000 Münzen pro Tausch.', 'You need at least 110 chips in your bankroll for one coin.': 'Du brauchst mindestens 110 Chips auf dem Konto für eine Münze.',
    'No friends yet. Add someone by their username — once they accept, you can see when they are online and invite them to your table.':
      'Noch keine Freunde. Füg jemanden per Benutzername hinzu – sobald er annimmt, siehst du, wann er online ist, und kannst ihn an deinen Tisch einladen.',
    'Test mode: no database is connected, so results are temporary.': 'Testmodus: keine Datenbank verbunden, Ergebnisse sind nur vorübergehend.',
    'The Club Room': 'Der Club-Raum', 'Salon Privé': 'Salon Privé', 'The Winter Palace': 'Der Winterpalast', 'The Wheel Room': 'Der Roulette-Saal', 'The Flamingo Lounge': 'Die Flamingo-Lounge',
    'Solo game': 'Einzelspiel', 'Gold': 'Gold', 'Rush': 'Rush',
    '🔒 Private table': '🔒 Privater Tisch', 'Private table': 'Privater Tisch', 'Friends only': 'Nur für Freunde', 'Join with a code': 'Mit Code beitreten',
    'Open your own': 'Eigenen Tisch eröffnen', 'Pick a game — you get a code to send to your friends. Only people with the code can sit down.': 'Wähl ein Spiel – du bekommst einen Code für deine Freunde. Nur wer den Code hat, kann sich setzen.',
    'Members can open a private table.': 'Mitglieder können einen privaten Tisch eröffnen.', 'No private table with that code — check it with your friend': 'Kein privater Tisch mit diesem Code – frag nochmal bei deinem Freund nach',
    'Code and link copied — send them to your friends.': 'Code und Link kopiert – schick sie deinen Freunden.', 'Share the code with your friends': 'Teile den Code mit deinen Freunden',
    'All private tables are taken right now — try again later': 'Gerade sind alle privaten Tische belegt – versuch es später nochmal', 'Sign in to open a private table': 'Melde dich an, um einen privaten Tisch zu eröffnen',
    'Message to everyone': 'Nachricht an alle',
    'Quests': 'Aufgaben', '🏆 Sit & Go': '🏆 Sit & Go', 'Start tournament': 'Turnier starten', 'Waiting for players…': 'Warte auf Spieler…', '🏆 Results': '🏆 Ergebnis',
    'A new tournament opens in a moment.': 'Gleich öffnet ein neues Turnier.', 'Sit & Go': 'Sit & Go',
    'Everyone starts with 1,500 chips, blinds rise every few hands, last one standing wins. Bots may fill seats but win nothing.': 'Alle starten mit 1.500 Chips, die Blinds steigen alle paar Hände, wer übrig bleibt, gewinnt. Bots dürfen mitspielen, gewinnen aber nichts.',
    'This tournament is already running — watch it or join the next one': 'Das Turnier läuft schon – schau zu oder spiel beim nächsten mit',
    'You need at least 2 players — invite a friend or a bot': 'Ihr braucht mindestens 2 Spieler – lade einen Freund oder Bot ein', 'Bots can only join before the tournament starts': 'Bots können nur vor dem Start dazukommen', "Today's quests": 'Heutige Aufgaben', 'Achievements': 'Erfolge',
    'Play 10 rounds of any game': 'Spiel 10 Runden in beliebigen Spielen', 'Win 3 rounds of any game': 'Gewinn 3 Runden in beliebigen Spielen', 'Play 3 different games': 'Spiel 3 verschiedene Spiele',
    'Win 2 hands of Blackjack': 'Gewinn 2 Hände Blackjack', "Play 5 hands of Hold'em": "Spiel 5 Hände Hold'em", 'Play 5 spins of Roulette': 'Spiel 5 Runden Roulette',
    'Win a game of Flamingo': 'Gewinn eine Partie Flamingo', 'Escape a game of Durak': 'Komm bei Durak raus', 'Reach 50 m in Gold Rush and cash out': 'Erreich 50 m in Gold Rush und zahl aus',
    'Win 500 chips today': 'Gewinn heute 500 Chips', "Play 3 hands of Hold'em with real people": "Spiel 3 Hände Hold'em mit echten Mitspielern",
    'First win': 'Erster Sieg', 'Win your first round': 'Gewinn deine erste Runde', 'Regular': 'Stammgast', 'Play 100 rounds': 'Spiel 100 Runden', 'Part of the furniture': 'Gehört zum Inventar',
    'Play 1,000 rounds': 'Spiel 1.000 Runden', 'Big pot': 'Großer Pot', 'Win 1,000 chips or more in one round': 'Gewinn 1.000 Chips oder mehr in einer Runde', 'High earner': 'Großverdiener',
    'Win 10,000 chips in total': 'Gewinn insgesamt 10.000 Chips', 'All-rounder': 'Allrounder', 'Play every game at least once': 'Spiel jedes Spiel mindestens einmal',
    'Flamingo master': 'Flamingo-Meister', 'Win 10 games of Flamingo': 'Gewinn 10 Partien Flamingo', 'Never the fool': 'Nie der Durak', 'Escape 10 games of Durak': 'Komm 10-mal bei Durak raus',
    'Deep digger': 'Tiefgräber', 'Cash out at 100 m in Gold Rush': 'Zahl in Gold Rush bei 100 m aus', 'Every day': 'Jeden Tag', 'Collect the daily bonus 7 days in a row': 'Hol dir den Tagesbonus 7 Tage am Stück',
  });

  // ---------- patterns for texts with numbers or names ----------
  const P = [
    [/^Today ([\d,.]+) \/ ([\d,.]+)$/, 'Heute $1 / $2'],
    [/^Day (\d+)$/, 'Tag $1'],
    [/^The board would have been: (.+)$/, 'Das Board wäre gewesen: $1'],
    [/^You have won the most table coins for today \(([\d,.]+)\)\. Wins still count for your chips — more coins tomorrow\.$/, 'Du hast heute die meisten Tisch-Münzen gewonnen ($1). Gewinne zählen weiter für deine Chips – morgen gibt es wieder Münzen.'],
    [/^Your ([\d,.]+) chips are at a table right now\. Leave the table and they come back to your bankroll — then you can exchange them\.$/, 'Deine $1 Chips liegen gerade an einem Tisch. Verlass den Tisch, dann kommen sie zurück auf dein Konto – und du kannst sie tauschen.'],
    [/^You bet with them at the tables\. Below ([\d,.]+)\? Once a day the house tops you up to ([\d,.]+)\.$/, 'Damit setzt du an den Tischen. Unter $1? Einmal am Tag füllt das Haus auf $2 auf.'],
    [/^You earn 1 coin for every ([\d,.]+) chips you win \(up to ([\d,.]+) a day\) plus the daily bonus — and spend them in the Shop\.$/, 'Du bekommst 1 Münze pro $1 gewonnenen Chips (bis $2 am Tag) plus den Tagesbonus – und gibst sie im Shop aus.'],
    [/^at ([\d,.]+) chips = 1 coin and keeps (\d+) % of each exchange\.$/, 'zu $1 Chips = 1 Münze und behält $2 % jedes Tauschs.'],
    [/^Chips into coins and back: ([\d,.]+) chips buy 1 coin, 1 coin buys ([\d,.]+) chips \(the difference is the Bank's 10 % fee\)\.$/, 'Chips in Münzen und zurück: $1 Chips kaufen 1 Münze, 1 Münze kauft $2 Chips (die Differenz ist die 10 % Gebühr der Bank).'],
    [/^Should you ever fall below ([\d,.]+) chips, the house tops you up to ([\d,.]+) — once a day\. It also happens automatically when you sit down with too little\.$/, 'Fällst du unter $1 Chips, füllt das Haus dich auf $2 auf – einmal am Tag. Das passiert auch automatisch, wenn du dich mit zu wenig hinsetzt.'],
    [/^You are below ([\d,.]+) chips\. Once a day the house brings you back to ([\d,.]+)\.$/, 'Du hast unter $1 Chips. Einmal am Tag bringt dich das Haus zurück auf $2.'],
    [/^1 coin for every 100 chips you win \(at least 1 per win\); escaping a game of Durak earns 10\. Today: ([\d,.]+) \/ ([\d,.]+)\.$/, '1 Münze pro 100 gewonnenen Chips (mindestens 1 pro Gewinn); bei Durak rauszukommen bringt 10. Heute: $1 / $2.'],
    [/^(.*) · cards are dealt automatically once enough players are seated\.$/, (m, a) => `${tr(a)} · es wird automatisch ausgeteilt, sobald genug Spieler sitzen.`],
    [/^Two to six players · 108 pink cards$/, 'Zwei bis sechs Spieler · 108 rosa Karten'], [/^Two to six players · 36 cards$/, 'Zwei bis sechs Spieler · 36 Karten'],
    [/^(Texas Hold'em|Blackjack|Durak|Roulette|Flamingo) · (.*)$/, (m, a, b) => `${a} · ${tr(b)}`],
    [/^Your coins: ?$/, 'Deine Münzen:'],
    [/^Entry ([\d,.]+) · (\d+) players? · (.*)$/, (m, a, b, c) => `Einsatz ${a} · ${b} Spieler · ${tr(c)}`], [/^Winner takes ([\d,.]+)$/, 'Gewinner bekommt $1'], [/^1st ([\d,.]+) · 2nd ([\d,.]+)$/, '1. Platz $1 · 2. Platz $2'],
    [/^🏆 Level (\d+) · Blinds (.*)$/, '🏆 Stufe $1 · Blinds $2'], [/^Next: (.*) in (\d+) hands? · (.*)$/, (m, a, b, c) => `Nächste: ${a} in ${b} ${b === '1' ? 'Hand' : 'Händen'} · ${tr(c)}`],
    [/^Out: (.*)$/, 'Raus: $1'], [/^Sit & Go · entry ([\d,.]+)$/, 'Sit & Go · Einsatz $1'], [/^🏆 (.*) wins the Sit & Go!(.*)$/, (m, a, b) => `🏆 ${a} gewinnt das Sit & Go!${b ? ' Die Gewinne sind auf den Konten.' : ''}`],
    [/^You are out of the tournament — place (\d+)\. You can keep watching\.$/, 'Du bist raus – Platz $1. Du kannst weiter zuschauen.'], [/^Hold'em · Sit & Go$/, "Hold'em · Sit & Go"],
    [/^New quests in (\d+) h (\d+) min$/, 'Neue Aufgaben in $1 Std. $2 Min.'], [/^(\d+) of (\d+) unlocked$/, '$1 von $2 freigeschaltet'], [/^🎯 Quests (\d)\/3$/, '🎯 Aufgaben $1/3'],
    [/^(✅|🏆) (.*)$/, (m, a, b) => `${a} ${tr(b)}`],
    [/^🔒 (P-[A-Z0-9]+) · Share$/, '🔒 $1 · Teilen'], [/^(.*)'s table$/, 'Tisch von $1'],
    [/^Your private table is open — code (P-[A-Z0-9]+)\. Share it with your friends!$/, 'Dein privater Tisch ist offen – Code $1. Teile ihn mit deinen Freunden!'],
    [/^You already have a private (.*) table \((P-[A-Z0-9]+)\) — close it first by leaving it$/, 'Du hast schon einen privaten $1-Tisch ($2) – verlass ihn zuerst'],
    [/^📣 (.*)$/, (m, a) => `📣 ${tr(a)}`], [/^🎁 A gift from the house: (.*) for every member!$/, (m, a) => `🎁 Ein Geschenk vom Haus: ${a.replace(' chips', ' Chips').replace(' coins', ' Münzen').replace(' and ', ' und ')} für jedes Mitglied!`],
    [/^Bets from ([\d,.]+)$/, 'Einsätze ab $1'], [/^Blinds ([\d,.]+) \/ ([\d,.]+)$/, 'Blinds $1 / $2'], [/^buy-in ([\d,.]+)$/, 'Einsatz $1'],
    [/^(.*) · buy-in ([\d,.]+)(.*)$/, (m, a, b, c) => `${tr(a)} · Buy-in ${b}${c.replace(' · members only', ' · nur Mitglieder').replace(/ · members with ([\d,.]+)\+ chips/, ' · Mitglieder mit $1+ Chips')}`],
    [/^2–6 players · members with ([\d,.]+)\+ chips$/, '2–6 Spieler · Mitglieder mit $1+ Chips'],
    [/^Table 1 · (.*)$/, (m, a) => `Tisch 1 · ${tr(a)}`], [/^Game (\d+)$/, 'Spiel $1'], [/^ · Game (\d+)$/, ' · Spiel $1'],
    [/^(\d+) playing now$/, '$1 spielen gerade'], [/^You still have a seat at$/, 'Du hast noch einen Platz an'],
    [/^Collect (\d+) coins$/, '$1 Münzen abholen'], [/^🎁 Collect (\d+) coins$/, '🎁 $1 Münzen abholen'], [/^Next gift in (.*) · (\d+) coins$/, (m, a, b) => `Nächstes Geschenk in ${a} · ${b} Münzen`],
    [/^Receive ([\d,.]+) chips$/, '$1 Chips erhalten'], [/^Next top-up in (.*)$/, 'Nächstes Auffüllen in $1'],
    [/^Today: ([\d,.]+) \/ ([\d,.]+)\.?$/, 'Heute: $1 / $2'], [/^(\d+) more coins$/, 'Noch $1 Münzen'],
    [/^Good (morning|afternoon|evening|night), (.*)$/, (m, a, b) => `${{ morning: 'Guten Morgen', afternoon: 'Guten Tag', evening: 'Guten Abend', night: 'Gute Nacht' }[a]}, ${b}`],
    [/^Table stack ([\d,.]+)$/, 'Tisch-Chips $1'], [/^([\d,.]+) chips free$/, '$1 Chips frei'], [/^The minimum bet is ([\d,.]+)\.?$/, 'Mindesteinsatz ist $1.'],
    [/^The book says: (.*)\.$/, (m, a) => `Die Strategie sagt: ${tr(a.charAt(0).toUpperCase() + a.slice(1)).toLowerCase()}.`],
    [/^Call ([\d,.]+)$/, 'Mitgehen $1'], [/^Raise to ([\d,.]+)$/, 'Erhöhen auf $1'], [/^Bet ([\d,.]+)$/, 'Setzen $1'], [/^All-in ([\d,.]+)$/, 'All-in $1'],
    [/^Calling ([\d,.]+) to win ([\d,.]+) needs (.*)\. (.*)$/, (m, a, b, c, d) => `Mitgehen mit ${a}, um ${b} zu gewinnen, braucht ${c}. ${tr(d)}`],
    [/^(.*) wins ([\d,.]+)( with (.*))?$/, (m, a, b, c, d) => `${a} gewinnt ${b}${d ? ' mit ' + tr(d) : ''}`],
    [/^You won ([\d,.]+)\.$/, 'Du hast $1 gewonnen.'], [/^You win ([\d,.]+)$/, 'Du gewinnst $1'],
    [/^(.*) is thinking…$/, '$1 überlegt…'], [/^(.*) is playing…$/, '$1 spielt…'], [/^(.*) is placing a bet…$/, '$1 setzt…'],
    [/^(.*) is attacking…$/, '$1 greift an…'], [/^(.*) is defending…$/, '$1 verteidigt…'], [/^(.*) may add cards…$/, '$1 darf zulegen…'],
    [/^(.*) is the durak!$/, '$1 ist der Durak!'], [/^(.*) wins the game!$/, '$1 gewinnt das Spiel!'],
    [/^Dealer shows (\d+)$/, 'Dealer zeigt $1'], [/^Dealer has (\d+)( — bust)?$/, (m, a, b) => `Dealer hat ${a}${b ? ' – überkauft' : ''}`],
    [/^Soft (\d+)$/, 'Soft $1'], [/^Won ([\d,.]+)$/, 'Gewinn $1'], [/^Lost ([\d,.]+)$/, 'Verlust $1'],
    [/^Your turn — match (.*) or the number\.$/, (m, a) => `Du bist dran – bediene ${tr(a)} oder die Zahl.`], [/^You drew (.*) — play it or pass\.$/, (m, a) => `Du hast ${a} gezogen – spielen oder passen.`],
    [/^Play (.*)$/, (m, a) => `Spiele ${tr(a)}`], [/^Selected: (.*)$/, 'Ausgewählt: $1'], [/^(\d+) cards$/, '$1 Karten'], [/^(\d+) left$/, 'noch $1'],
    [/^(.*) \(chosen\)$/, (m, a) => `${tr(a)} (gewählt)`],
    [/^You are defending — beat the (.*), or take the cards\.$/, 'Du verteidigst – schlag $1 oder nimm die Karten.'], [/^You cannot beat the (.*) — take the cards\.$/, 'Du kannst $1 nicht schlagen – nimm die Karten.'],
    [/^(.*) is taking — add cards of a rank on the table\?$/, '$1 nimmt – Karten mit einem Wert vom Tisch zulegen?'],
    [/^(Attack with|Beat with|Add) (.*)$/, (m, a, b) => `${{ 'Attack with': 'Angreifen mit', 'Beat with': 'Schlagen mit', Add: 'Zulegen' }[a]} ${b}`],
    [/^Dig deeper → (.*)$/, 'Tiefer graben → $1'], [/^Cash out ([\d,.]+)$/, '$1 auszahlen'], [/^Cash out$/, 'Auszahlen'],
    [/^Cave-in at (\d+) m — the stake of ([\d,.]+) is lost\.$/, 'Einsturz bei $1 m – der Einsatz von $2 ist weg.'],
    [/^(You reached the bottom! )?Cashed out ([\d,.]+) chips at (.*) \(\+([\d,.]+)\)$/, (m, a, b, c, d) => `${a ? 'Du hast den Grund erreicht! ' : ''}${b} Chips bei ${c} ausgezahlt (+${d})`],
    [/^(\d+) % · up to (.*)$/, '$1 % · bis $2'], [/^(\d+) m$/, '$1 m'],
    [/^⏱ (\d+)s$/, '⏱ $1 s'], [/^(\d+)s$/, '$1 s'],
    [/^🔧 Update in (.*) · current hands finish$/, '🔧 Update in $1 · laufende Hände werden fertig gespielt'],
    [/^The name “(.*)” is already taken — try another$/, 'Der Name „$1“ ist schon vergeben – versuch einen anderen'],
    [/^Welcome back, (.*)\.$/, 'Willkommen zurück, $1.'], [/^Welcome to the club, (.*)\. 5,000 chips are waiting for you\.$/, 'Willkommen im Club, $1. 5.000 Chips warten auf dich.'],
    [/^You need at least ([\d,.]+) chips for this table \(you have ([\d,.]+)\)$/, 'Du brauchst mindestens $1 Chips für diesen Tisch (du hast $2)'],
    [/^Your daily top-up: ([\d,.]+) chips from the house\.$/, 'Dein tägliches Auffüllen: $1 Chips vom Haus.'],
    [/^The server is restarting for an update — your chips are safe in your bankroll, plus 1,000 bonus chips for the interruption\. Rejoin in a moment\.$/,
      'Der Server startet für ein Update neu – deine Chips sind sicher auf deinem Konto, dazu 1.000 Bonus-Chips für die Unterbrechung. Gleich wieder einsteigen.'],
    [/^(.*) ran out of time$/, '$1 hat die Zeit überschritten'],
    [/^(\d+) (hands|spins)$/, (m, a, b) => `${a} ${b === 'hands' ? 'Hände' : 'Runden'}`],
  ];

  function tr(text) {
    if (lang() !== 'de' || !text) return text;
    if (Object.prototype.hasOwnProperty.call(DE, text)) return DE[text];
    for (const [re, to] of P) if (re.test(text)) return text.replace(re, to);
    return text;
  }

  // ---------- applying it to the page ----------
  const SKIP = '[data-no-i18n], .chat-list, .bubble, .name, .rt-head b + .x, script, style, textarea, input, .lb-list .name, .mb-hello b, .card, .card-back, .fcard, .chip, pre, code';
  const ATTRS = ['placeholder', 'title', 'aria-label'];
  const orig = new WeakMap();      // text node -> original English

  function doText(node) {
    const p = node.parentElement;
    if (!p || p.closest(SKIP)) return;
    let src = orig.get(node);
    const cur = node.nodeValue;
    // the page changed the text since we translated it: that is the new original
    if (src === undefined || (cur !== src && cur !== tr(src))) { src = cur; orig.set(node, src); }
    const raw = src.trim();
    if (!raw || !/[A-Za-z]/.test(raw)) return;
    const t = tr(raw);
    const out = t === raw ? src : src.replace(raw, t);
    if (node.nodeValue !== out) node.nodeValue = out;
  }
  function doAttrs(el) {
    if (el.closest(SKIP.replace(', input', '').replace(', textarea', ''))) return;
    for (const a of ATTRS) {
      if (!el.hasAttribute(a)) continue;
      const key = 'i18n' + a.replace(/-./g, (x) => x[1].toUpperCase());
      let src = el.dataset[key];
      const cur = el.getAttribute(a);
      if (src === undefined || (cur !== src && cur !== tr(src))) { src = cur; el.dataset[key] = src; }
      const t = tr(src);
      if (cur !== t) el.setAttribute(a, t);
    }
  }
  function walk(root) {
    if (root.nodeType === 3) { doText(root); return; }
    if (root.nodeType !== 1) return;
    doAttrs(root);
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let n;
    while ((n = tw.nextNode())) { if (n.nodeType === 3) doText(n); else doAttrs(n); }
  }

  let busy = false;
  const obs = new MutationObserver((list) => {
    if (busy) return;
    busy = true;
    try {
      for (const m of list) {
        if (m.type === 'characterData') doText(m.target);
        else if (m.type === 'attributes') doAttrs(m.target);
        else m.addedNodes.forEach(walk);
      }
    } finally { busy = false; obs.takeRecords(); }
  });
  function start() {
    document.documentElement.lang = lang();
    walk(document.body);
    obs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);

  // native dialogs (confirm / alert) too
  const nConfirm = window.confirm.bind(window);
  window.confirm = (msg) => nConfirm(tr(String(msg)));

  window.I18n = {
    lang, t: tr,
    set(l) {
      if (!['de', 'en'].includes(l) || l === lang()) return;
      localStorage.setItem(KEY, l);
      location.reload();     // simplest way to redraw every text from its original
    },
  };
})();
