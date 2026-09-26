"""The 210 waiting queries of The Secret Doctrine Vol. II, decided by the
standing rulings (RULINGS.md), the editor's own Vol. I rulings of 2026-09-24,
and the counts over the assembled book and its notes. Writes decisions.json:
rulings to file, class sweeps to run, standing rulings for the record, and the
places that stay the editor's, offered as proposals."""
import json, re
from collections import Counter, defaultdict

W = json.load(open('/tmp/claude-0/sdk2/waiting.json'))
C = json.load(open('/tmp/claude-0/sdk2/corpus.json'))
strip = lambda s: re.sub(r'</?(?:i|em|b|strong)>', '', s)
P = {k: strip(v) for k, v in C.items()}          # plain text, as sweep matches it

def count(pat):
    return sum(len(re.findall(pat, t)) for t in P.values())

BECAUSE = {
 'unpaired': "Editor's standing ruling 2026-09-24 (The Secret Doctrine Vol. I): where a quotation opens and never closes, or closes without opening, it is left as printed, the mark unpaired; where it should close is a choice this edition does not make. Applied to Vol. II under the same ruling.",
 'bracket': "Editor's standing ruling 2026-09-24 (Vol. I) on unpaired quotation marks, applied to a bracket: left as printed, the mark unpaired; where it should close is a choice this edition does not make.",
 'author': "Standing ruling 1 (RULINGS.md): a name as the author spelled it, set once in the volume, is a note and not a correction; there is nothing in the book to count it against.",
 'citation': "Standing ruling 1 (RULINGS.md): a citation the author got wrong is a note, not a correction.",
 'quoted': "Kept as the quoted source prints it: a spelling inside a quotation from another author is that author's, and standing ruling 3 counts the book's own usage, not its quotations.",
 'self': "The Stanza and the commentary's copy of the sloka disagree; each is kept as printed and the difference is told to the reader, as standing ruling 1 does with the author's own slips.",
 'grammar': "The author's own English, both readings agreeing; kept as printed under standing ruling 1, which leaves a period or author's usage alone.",
 'brahma': "Standing ruling 2 (RULINGS.md): Brahma and Brahmâ are two words, the neuter Absolute and the masculine creator, and are not normalised; each place stands as its reading's trace shows it.",
 'point': "Standing ruling 1 (RULINGS.md): a stop missing where a sentence ends and the next begins with a capital, corrected as the editor corrected the same fault on leaves 14 and 40 of this volume.",
 'consistent': "The book now sets the term one way throughout (counted over the body and the notes), so there is nothing left to reconcile.",
}
def r2(word, counts):  return f"Standing ruling 2 (RULINGS.md): one form per term, the accented form; counted over the assembled book and its notes: {counts}. The bare settings are swept to {word}."
def r3(word, counts):  return f"Standing ruling 3 (RULINGS.md): a spelling that varies within a book is settled to its majority form, counted over the assembled book and its notes: {counts}. Swept to {word}."
def tie(word, why):    return f"Editor's ruling 2026-09-24 (Vol. I), extending standing ruling 3: a one-to-one tie the count cannot settle goes to the scholarly correct form, {word}: {why}"
def lig(word):         return f"Editor's ruling 2026-09-24 (Vol. I): the proper spelling, with the ligature ({word}), as the book sets it elsewhere."

# ---- per-query decisions: (leaf, quote prefix, decision, correction, because)
D = []
def q(leaf, prefix, decision, correction=None, because=''):
    D.append(dict(leaf=leaf, prefix=prefix, decision=decision, correction=correction, because=because))

# A. unpaired quotation marks and brackets — the editor's standing ruling
for leaf, pre in [(15,'the seven may'),(27,'Then a Seventh'),(39,'and Ahti'),(57,'“IS H ALL'),(89,'St. Paul enjoins'),
 (96,'We have learned'),(113,'shining bright'),(122,'They had no fire'),(124,'in the “Soul”'),(150,'“In the Tzalam'),
 (155,'Hence Captain'),(168,'“the time represented'),(177,'Progenitors.'),(189,'The text has'),(195,'who are Adityas'),
 (205,'“In the initial'),(207,'life. “or mother'),(220,'Pneumatologie'),(229,'it is plainly'),(268,'“cursed to be'),
 (273,'covered over by'),(299,'The Greeks in the 4th'),(301,'the dumb man'),(303,'(Zohar,”'),(305,'or the Souls'),
 (308,'The question is often'),(326,'In the Symbolism'),(328,'Said R. El'),(342,'“The axle'),(367,'and we may add'),
 (372,'Levi’s Histoire'),(384,'only by stone'),(387,'(i.e., those already'),(388,'(b’ne-aleim)”'),(389,'b ‘ne - aleim'),
 (406,'was THE JUST ONE'),(406,'read as “and thegod'),(419,'the extremity'),(425,'in their stead'),(440,'his wicked'),
 (442,'and that ‘certainly'),(445,'“Assuming that'),(462,'with non Being'),(466,'“the doctrines'),(473,'meaning also'),
 (476,'The mystic word'),(480,'“the perfect one'),(493,'tells them'),(494,'from an ‘immaculate'),(509,'in these words'),
 (531,'the number of whose'),(549,'Androgynous'),(570,'“‘Attach thyself'),(571,'The very construction'),(576,'“The Sevenfold'),
 (604,'commingling of the'),(619,'(“panca'),(620,'(Orm. Ahr.'),(632,'called Dwadasa'),(634,'[“ad bhutam'),(643,'“The followers'),
 (648,'I am the crocodile'),(675,'are for ever removed'),(678,'Darwin connects'),(685,'as the “cell-soul'),(691,'“In all probability'),
 (752,'“The palaolithic'),(753,'“It will be remembered'),(759,'“Since it disregards'),(760,'the famous Thenay'),(761,'(Albert Gaudry'),
 (763,'Barbary to Spain')]:
    q(leaf, pre, 'as-printed', None, BECAUSE['unpaired'])
for leaf, pre in [(156,'—(Orph.'),(391,'which on Earth is Mahat'),(537,'(Revue germanique'),(636,'(See “Approaching'),(554,'(Isis Unveiled), Vol.')]:
    q(leaf, pre, 'as-printed', None, BECAUSE['bracket'])
# the sloka on 33: the book's own copy closes the quotation, so the place is not in doubt
q(33, '34. “THE AMANASA', 'corrected', 'LEST WORSE SHOULD HAPPEN.” THEY DID',
  "Standing ruling 1 (RULINGS.md): an unpaired quotation mark where the place it belongs is not in doubt is corrected. The commentary's own copy of this sloka (leaf 204) closes it after HAPPEN, and the editor took the pointing of slokas 27 and 28 from their commentary copies on this volume (leaf 30).")

# B. spellings inside quotations from other authors, the author's own slips, the book against itself
for leaf, pre in [(114,'Twastri'),(398,'Simoon is called'),(405,'or Pater S a di e'),(406,'Sadik, the Just'),(703,'Akkadabout'),(771,'a peasant girl')]:
    q(leaf, pre, 'noted', None, BECAUSE['quoted'])
for leaf, pre in [(47,'at Cichen'),(119,'Aschieros'),(135,'Phœbe and Hilasira'),(330,'Mr. Louis Stephenson'),(453,'§ Dr. Cover'),
 (491,'Deus est Demon'),(497,'as Guignault'),(521,'the doctrine of Cerinthius'),(544,'Pereisc'),(574,'and Muir shows'),
 (579,'the sages Narada'),(614,'as Marcelinus'),(804,'Sir C. Wyville'),(121,'5. Bhutatman')]:
    q(leaf, pre, 'noted', None, BECAUSE['author'])
for leaf, pre in [(135,'Theocras'),(138,'(ch. v. 5)'),(186,'“Five Years'),(375,'And he refers'),(376,'(See Hyde'),(388,'Reflections'),
 (404,'origin of Cain'),(473,'Genesis xxxvii'),(514,'(See Isaiah'),(539,'(Philosoph. Plant'),(575,'(Dogma et'),(579,'says John of'),
 (619,'(Hymn X. 20'),(633,'Menses in quinos')]:
    q(leaf, pre, 'noted', None, BECAUSE['citation'])
for leaf, pre in [(134,'THE OLD WING'),(204,'35. THEN ALL'),(214,'GIANT - FISH'),(329,'OF RARE EARTHS')]:
    q(leaf, pre, 'noted', None, BECAUSE['self'])
for leaf, pre in [(160,'not one of our'),(729,'The theory cuts'),(749,'The stages of')]:
    q(leaf, pre, 'noted', None, BECAUSE['grammar'])
for leaf, pre in [(71,'when Brahmâ wants'),(72,'Continuing to create'),(73,'Here Brahma stands'),(159,'after a “Day of Brahmâ”')]:
    q(leaf, pre, 'noted', None, BECAUSE['brahma'])
q(184, 'HOW DID THE MANASA', 'as-printed', None, BECAUSE['consistent'] + ' MANASA is set four times, in the Stanza and the commentary alike.')
q(405, 'New Encycloptedia', 'as-printed', None, BECAUSE['consistent'] + ' Encyclopædia ×13.')
q(408, 'In “Tinueus”', 'as-printed', None, BECAUSE['consistent'] + ' Timæus ×11.')
q(744, '“Aniyamsam Aniyasam', 'noted', None, "Leaf 60 sets the phrase bare too (aniyamsam aniyasam, no trace in either reading there), so the book has no accented Aniyâmsam to normalise to under ruling 2; the second word carries its trace and stands. Told to the reader.")
q(359, 'Vormius and Olaiis', 'as-printed', None, "Set Olaüs from the ii trace under the editor's accents ruling; the body and notes set the name nowhere else, so there is nothing to count.")

# C. pointing
q(139, 'will both yield', 'corrected', 'will both yield their meaning. In Manu', BECAUSE['point'])
q(179, 'p. 39, et. seq.', 'corrected', 'p. 39, et seq.,', r3('et seq.', 'et seq. ×75, et. seq. ×1'))

# D. one term two ways — settled by count under rulings 2 and 3
def cnt(*forms):
    return ', '.join(f"{f} ×{count(re.escape(f) if not f.startswith('(?') else f)}" for f in forms)
q(24, 'would not surrender', 'corrected', 'would not surrender a millennium of it', tie('millennium', 'millennium ×20 (with its plural) against millenium ×1 in this volume; across both volumes the double n is the majority.'))
q(37, 'first objectivation', 'as-printed', None, r2('Mûlaprakriti', 'Mûlaprakriti ×1 (this place), Mulaprakriti ×6') + " The editor ruled the same word the same way on Vol. I.")
q(59, 'causality (avayakta)', 'corrected', 'causality (avyakta)', tie('avyakta', 'avayakta ×1 here against avyakta ×1 (Vol. I); avyakta is the Sanskrit.'))
q(63, '“Romakapura”', 'corrected', '“Romaka-pura” was in “the West,”', r3('Romaka-pura', 'Romaka-pura ×4, Romakapura ×1'))
q(70, 'Pavaka, Pavamâna', 'as-printed', None, r2('Pavamâna', 'Pavamâna ×2, Pavamana ×1'))
q(72, 'This is Kriya-sakti', 'corrected', 'This is Kriyasakti—the mysterious Yoga power', r3('Kriyasakti', 'Kriyasakti ×14, Kriya-sakti ×1'))
q(89, 'Read the explanation', 'as-printed', None, r3('Parâsara', 'Parâsara ×11, Parasâra ×6, Parasara ×5'))
q(245, 'Parâsara (Vishnu', 'as-printed', None, r3('Parâsara', 'Parâsara ×11, Parasâra ×6, Parasara ×5'))
q(105, 'Asura-Mazdhâ', 'as-printed', None, r2('Mazdhâ', 'Mazdhâ ×2, Mazdha ×1'))
q(133, 'Whereas it is our Dhyan', 'corrected', 'Whereas it is our Dhyan-Chohanic essence', r3('Dhyan-Chohanic', 'Dhyan-Chohanic ×7, Dhyan Chohanic ×3'))
q(153, 'the Bhagavad Gita (see', 'corrected', 'the Bhagavad Gitâ (see “Theosophist,” April, 1887, p. 444)', r2('Gitâ', 'Gitâ ×4, Gita ×5'))
q(156, 'repetition of Vach', 'corrected', 'repetition of Vâch. Both Ida and Vâch are turned into males and females; Ida becoming Sudyumna, and Vâch,', r2('Vâch', 'Vâch ×11, Vach ×8'))
q(160, 'The forthcoming 6th', 'corrected', 'The forthcoming 6th Sub-Race', r3('Sub-Race', 'Sub-Race ×39, Sub Race ×1'))
q(173, 'Brasseur de Bourbourg', 'corrected', 'Brasseur de Bourbourg’s “Popol-Vuh,”', r3('Popol-Vuh', cnt('Popol-Vuh', 'Popul-Vuh', 'Popul-vuh')))
q(178, 'Haeckel and his like', 'corrected', 'Hæckel and his like', lig('Hæckel'))
q(185, 'THE Two - F o LD', 'as-printed', None, r3('TWO-FOLD', 'TWO-FOLD ×3, TWOFOLD ×1 (the Stanza on leaf 32, swept to it)'))
q(187, 'in a Cosmic allegory', 'corrected', 'in a Cosmic allegory in the Purânas.', r2('Purâna(s)', cnt('Purânas', 'Puranas', 'Purâna', 'Purana', 'Purânic', 'Puranic')))
q(188, 'became the hvely girl', 'corrected', 'became the lovely girl named Mârishâ.”†', "Standing ruling 2 (RULINGS.md): one form per term, the accented form. The traces fall on the first vowel at two settings (Mârisha) and on the last at two (Marishâ), and once on both (Mârishâ); the accented form that carries every trace is Mârishâ, which is also the Sanskrit (Māriṣā). All six settings swept to it.")
q(192, 'he is Chenresi', 'corrected', 'he is Chenresi, the Dhyani and Bodhisattva,', r3('Bodhisattva', 'Bodhisattva(s) ×4, Bhodhisatva ×1, Bhodisatva ×1 (the two on leaf 191, both swept)'))
q(223, 'Abu! Teda', 'corrected', 'Abul-Feda', tie('Abul-Feda', 'set once each way; leaf 379 cites the same author and the same Historia Anteislamitica as Abul-Feda.'))
q(224, 'Vivisvat the Sun', 'corrected', 'Vivasvat the Sun', tie('Vivasvat', 'set once each way; Vivasvat is the Sanskrit, as leaf 266 sets it.'))
q(226, 'But as to the Nagals', 'as-printed', None, r2('Nâgal(s)', 'Nâgals ×1, Nagals ×3, Nâgal ×1, Nagal ×1'))
q(227, 'married Ulupi', 'corrected', 'married Ulûpi,*', r2('Ulûpi', 'Ulûpi ×3, Ulupi ×2'))
q(238, 'architecture (Ferguson)', 'corrected', 'architecture (Fergusson)', r3('Fergusson', 'Fergusson ×3, Ferguson ×1'))
q(239, 'Colonel vans Kennedy', 'corrected', 'Colonel Vans Kennedy', tie('Vans Kennedy', 'set once each way; the proper name takes its capital, as leaf 323 sets it.'))
q(240, 'the Rakshasas and the Daityas', 'corrected', 'the Râkshasas and the Daityas', r2('Râkshasas', 'Râkshasas ×13, Rakshasas ×14'))
q(278, 'a Northern and post', 'corrected', 'a Northern and postdiluvian nation', r3('postdiluvian', 'postdiluvian ×4, post-diluvian ×3, post diluvian ×2'))
q(282, 'Mythologie de la Grece', 'corrected', 'Mythologie de la Grèce Antique', "The second reading prints é wherever French sets an accent on e, and neither reading can tell é from è; French has Grèce. Read from the word, as the editor's rule for a mark the readings cannot settle directs, and set Grèce at every setting of the title (Gréce ×7, Grece ×4).")
q(322, 'G- Rudra Sarvarna', 'corrected', 'G—Rudra Savarna.', r3('Savarna', 'Savarna ×4 in the same list, Sarvarna ×1'))
q(336, 'the temple built by Samba', 'as-printed', None, r2('Sâmba', 'Sâmba ×3, Samba ×4'))
q(351, 'Hiouen Thsang, speaks', 'as-printed', None, tie('Hiouen-Thsang', 'set once each way; the hyphen is Julien\'s own form of the name, and the one this leaf prints first.'))
q(360, 'geological commotions” (Charlton)', 'corrected', 'geological commotions” (Charton)', r3('Charton', 'Charton ×4 (the note on this leaf and three elsewhere), Charlton ×1'))
q(369, 'Airyana Vaego by', 'as-printed', None, r3('Airyana Vaego', cnt('Airyana Vaego', 'Airyana-Vaego')))
q(370, 'Meru and Patala', 'corrected', 'Meru and Pâtâla have one significance', r3('Pâtâla', 'Pâtâla ×10, Patâla ×3, Patâlâ ×1, Pâtala ×1, Patala ×1'))
q(375, 'Axiokersos (Pluto', 'as-printed', None, tie('Axiokersa', 'set once each way; the note on this leaf sets it solid, which is the Greek.'))
q(394, 'is called in the Rig-Veda Vaiswanara', 'corrected', 'is called in the Rig-Veda Vaisvânara. Now Vaisvânara', r3('Vaisvânara', 'Vaisvânara ×4, Vaiswanara ×3, Vaisvanara ×2') + ' (ruling 2 then takes the accented form).')
q(402, 'emanation of Ilda Baoth', 'corrected', 'emanation of Ilda-Baoth', r3('Ilda-Baoth', 'Ilda-Baoth ×7, Ilda Baoth ×1'))
q(414, 'from the Sitrya', 'corrected', 'from the Sûrya Siddhanta:', r3('Siddhanta', 'Siddhanta ×3, Sidhanta ×1'))
q(417, 'Krauncha, Saka', 'as-printed', None, r2('Sâka', 'Sâka ×5, Saka ×4'))
q(421, 'Asburj (or Azburj)', 'corrected', 'Ashburj (or Azburj)', r3('Ashburj', 'Ashburj ×3, Asburj ×1'))
q(432, 'India -the Arya', 'corrected', 'India—the Aryavarta of old', r3('Aryavarta', 'Aryavarta ×4, Arya-varta ×1'))
q(440, 'Agneydstra', 'as-printed', None, r2('Agneyâstra', 'Agneyâstra ×5, Agneyastra ×4'))
q(642, 'out of the Agneyâstra', 'as-printed', None, r2('Agneyâstra', 'Agneyâstra ×5, Agneyastra ×4'))
q(440, 'Viwan of every lord', 'as-printed', None, r2('Viwân', 'Viwân(s) ×4, Viwan ×1'))
q(452, 'Writing, our scientists', 'as-printed', None, r2('Pânini', 'Pânini ×2, Panini ×5'))
q(466, 'that work—Qu-tamy', 'corrected', 'that work—Qu-tâmy.', r2('Qu-tâmy', 'Qu-tâmy ×4, Qu-tamy ×2'))
q(511, 'T.A.R.A.', 'corrected', '“TÂRÂ”*', "Standing ruling 2 (RULINGS.md): one form per term, the accented form. The traces fall on the first vowel here (TÂRA) and on the last at three settings (Tarâ); the accented form that carries both is Târâ, the Sanskrit (Tārā). Tarâ ×3, Tara ×2 and TÂRA ×1 all swept to it.")
q(531, 'The Mystery of Agathadcemon', 'corrected', 'The Mystery of Agathodæmon', r3('Agathodæmon', 'Agathodæmon ×11, Agathadæmon ×1'))
q(580, 'the great Oxford', 'corrected', 'the great Oxford Sanskritist, Max Müller', r2('Müller', 'Müller ×17, Muller ×8'))
q(673, 'Professor Max Muller', 'corrected', 'Professor Max Müller', r2('Müller', 'Müller ×17, Muller ×8'))
q(776, 'Max Muller’s Lectures', 'corrected', 'Max Müller’s Lectures', r2('Müller', 'Müller ×17, Muller ×8'))
q(580, 'the Prana and Apana', 'corrected', 'the Prâna and Apâna, but portions', r2('Prâna', 'Prâna ×4, Prana ×8'))
q(583, 'vice versa, as was', 'as-printed', None, r2('versâ', 'vice versâ ×7, vice versa ×2'))
q(723, 'and vice versa.', 'corrected', 'and vice versâ.', r2('versâ', 'vice versâ ×7, vice versa ×2'))
q(583, 'great cycle-J atayu', 'as-printed', None, r2('Jâtayu', 'Jâtayu ×1, Jatayu ×2'))
q(585, 'the three “Secret” Kumaras', 'corrected', 'the three “Secret” Kumâras', r2('Kumâra(s)', 'Kumâras ×26, Kumaras ×6, Kumâra ×19, Kumara ×8'))
q(626, 'the seven Kumaras', 'corrected', 'the seven Kumâras or the eleven Rudras', r2('Kumâra(s)', 'Kumâras ×26, Kumaras ×6, Kumâra ×19, Kumara ×8'))
q(622, 'Spenta Armalta', 'as-printed', None, r3('Armaita', 'Armaita ×3, Armaiti ×1'))
q(625, 'the tail of Ursa Minor', 'as-printed', None, r2('Sisumâra', 'Sisumâra ×2, Sisumara ×1'))
q(612, 'Tetragrammaton, or the Tetractys', 'corrected', 'Tetragrammaton, or the Tetraktis of the Greeks', r3('Tetraktis', 'Tetraktis ×12, Tetractys ×2, Tetractis ×1') + " The editor ruled Tetractis → Tetraktis on Vol. I.")
q(663, 'du Bois Reymond', 'corrected', 'du Bois-Reymond', r3('du Bois-Reymond', 'Bois-Reymond ×5, Bois Reymond ×3, Bois Raymond ×1'))
q(723, 'Du Bois Raymond', 'corrected', 'Du Bois-Reymond', r3('du Bois-Reymond', 'Bois-Reymond ×5, Bois Reymond ×3, Bois Raymond ×1'))
q(686, 'that to day seem', 'corrected', 'that to-day seem impassable', r3('to-day', 'to-day ×30, to day ×1'))
q(706, 'Helmholz calculates', 'corrected', 'Helmholtz calculates', r3('Helmholtz', 'Helmholtz ×2 (Vol. I ×7), Helmholz ×1'))
q(730, 'Emperor of Materialists', 'as-printed', None, r2('Büchner', 'Büchner ×6, Buchner ×2'))
q(727, 'is shown to be a remarkable', 'corrected', 'is shown to be a remarkable artist, Neolithic', r3('Neolithic', cnt('Neolithic', 'neolithic')))
q(525, 'Dr. Hartman’s', 'corrected', 'Dr. Hartmann’s', r3('Hartmann', 'Hartmann ×7, Hartman ×1; Franz Hartmann, the author of the Paracelsus cited, spells his name as the book spells Eduard von Hartmann\'s'))
q(81, 'from the pores of Virabhadara', 'corrected', 'from the pores of Virabhadra, the terrible giant', r3('Virabhadra', 'Virabhadra ×2 (leaf 195), Virabhadara ×1'))
q(693, '“Int;·oduction a l', 'corrected', '“Introduction à l’Etude des Races Humaines,”', r2('à', 'the body of this leaf sets à (from its trace); the note is swept to it'))

# E. left to the editor, with the reader's answers offered at the gate
PROPOSE = [
 (45, 'had been thus degraded', 'corrected', 'had been thus degraded by posterity. “The gods of our fathers are our devils,”', 'A full stop before the quotation, as the editor set on leaf 40 for a missing stop before a capital.'),
 (45, 'had been thus degraded', 'corrected', 'had been thus degraded by posterity: “The gods of our fathers are our devils,”', 'A colon, the author\'s usual pointing before a quoted maxim.'),
 (249, 'being Life and Life', 'corrected', 'being Life and Light', 'The Pymander passage pairs Life and Light, and the book\'s own commentary sets LIFE and LIGHT together (leaf 577); a compositor\'s repeated word.'),
 (249, 'being Life and Life', 'as-printed', None, 'Leave the doubled word as 1888 printed it.'),
 (444, 'years ago The more', 'corrected', 'years ago? The more', 'The quoted sentence from Isis Unveiled is a question; a question mark ends it.'),
 (444, 'years ago The more', 'corrected', 'years ago. The more', 'A full stop, as the editor set on leaf 40 for a missing stop before a capital.'),
 (673, 'Eve notsi', 'corrected', 'Eve is not “begotten,”', 'Transposed type: the sentence runs "Eve is not begotten, but is extracted out of Adam".'),
 (114, 'born from the conjunction', 'corrected', 'born from the conjunction of Pramanthâ and Arani', 'Ruling 2 by the traces on this leaf (Pramanthâ ×2 against Pramantha ×1); the lower-case pramantha ×8 elsewhere, and one pramântha, would then be settled the same way.'),
 (114, 'born from the conjunction', 'as-printed', None, 'Keep Pramantha bare here and settle the word by its majority (pramantha ×11 bare against 3 accented), the traces disagreeing about which vowel carries the accent.'),
 (192, 'Padmapani (Avalokiteshwara)', 'corrected', 'Padmapani (Avalokiteswara) becomes,', 'The majority form (Avalokiteswara ×3) under ruling 3, with the one Avalôkiteswara stripped to it, which is the editor\'s to do (Vol. I: Âkâsa).'),
 (192, 'Padmapani (Avalokiteshwara)', 'corrected', 'Padmapani (Avalôkiteswara) becomes,', 'Ruling 2: the accented form, from the one trace on leaf 191; the three bare settings swept to it.'),
 (379, 'was Sab<£an by origin', 'as-printed', None, 'Keep Sabæan here, the ligature being the proper spelling (the editor\'s fœtus ruling), and sweep the fourteen Sabean(s) to it.'),
 (379, 'was Sab<£an by origin', 'corrected', 'was Sabean by origin', 'The majority form (Sabean ×14) under ruling 3, stripping the one traced ligature, which is the editor\'s to do.'),
 (580, 'as Arjuna Misra believes', 'corrected', 'as Arjuna Misra believes', 'The majority form (Arjuna ×7 against Arjûna ×2) and the Sanskrit (short u); the trace is Tesseract\'s li for u, and stripping an accent is the editor\'s to do.'),
 (580, 'as Arjuna Misra believes', 'as-printed', None, 'Keep Arjûna where the trace shows it (ruling 2), and sweep the seven bare settings to it.'),
 (627, 'a general spread of A hamkara', 'corrected', 'a general spread of Ahamkara', 'The majority form (Ahamkara ×3) and the Sanskrit (ahaṃkāra, no long initial a); stripping the one traced accent is the editor\'s to do (Vol. I: Âkâsa).'),
 (627, 'a general spread of A hamkara', 'as-printed', None, 'Keep Âhamkara per its trace (ruling 2), and sweep the three bare settings to it.'),
 (628, 'the manifold aspects of A kasa', 'corrected', 'the manifold aspects of Akâsa’s lower principles', 'The book\'s form (Akâsa ×7, the form the editor ruled for Vol. I), stripping the one Âkâsa, which the editor kept as his own to do on Vol. I.'),
 (628, 'the manifold aspects of A kasa', 'as-printed', None, 'Keep Âkâsa per its trace.'),
 (647, 'What does Bi:ihme', 'corrected', 'What does Bœhme, the Prince', 'The form the editor ruled for Vol. I (Bœhme ×3 there), so that the name reads one way across the two volumes; Bohme ×3, Böhme ×1 and Boehme ×1 all swept to it.'),
 (647, 'What does Bi:ihme', 'as-printed', None, 'Keep Böhme, the German spelling the trace here shows, and sweep Bohme and Boehme to it.'),
]

# ---- class sweeps: (regex over the plain corpus, replacement)
SWEEPS = [
 (r'LEST WORSE SHOULD HAPPEN\. THEY DID', 'LEST WORSE SHOULD HAPPEN.” THEY DID'),
 (r'meaning, In Manu', 'meaning. In Manu'),
 (r'et\. seq\.', 'et seq.'),
 (r'\bmillenium\b', 'millennium'),
 (r'\bMulaprakriti\b', 'Mûlaprakriti'),
 (r'\(avayakta\)', '(avyakta)'),
 (r'\bRomakapura\b', 'Romaka-pura'),
 (r'\bPavamana\b', 'Pavamâna'),
 (r'\bKriya-sakti\b', 'Kriyasakti'),
 (r'\bParasâra\b', 'Parâsara'), (r'\bParasara\b', 'Parâsara'),
 (r'\bAhura-Mazdha\b', 'Ahura-Mazdhâ'),
 (r'\bDhyan Chohanic\b', 'Dhyan-Chohanic'),
 (r'\bGita\b', 'Gitâ'),
 (r'\bVach\b', 'Vâch'),
 (r'\b6th Sub Race\b', '6th Sub-Race'),
 (r'\bPopul-[Vv]uh\b', 'Popol-Vuh'),
 (r'\bHaeckel', 'Hæckel'),
 (r'\bTWOFOLD\b', 'TWO-FOLD'),
 (r'\bPuranas\b', 'Purânas'), (r'\bPurana\b', 'Purâna'), (r'\bPuranic\b', 'Purânic'),
 (r'\bM[âa]rish[âa]\b', 'Mârishâ'),
 (r'\bBhodhisatva\b', 'Bodhisattva'), (r'\bBhodisatva\b', 'Bodhisattva'),
 (r'\bAbul Teda\b', 'Abul-Feda'),
 (r'\bVivisvat\b', 'Vivasvat'),
 (r'\bNagals\b', 'Nâgals'), (r'\bNagal\b', 'Nâgal'),
 (r'\bUlupi\b', 'Ulûpi'),
 (r'\(Ferguson\)', '(Fergusson)'),
 (r'\bvans Kennedy\b', 'Vans Kennedy'),
 (r'\bRakshasas\b', 'Râkshasas'),
 (r'\bpost-diluvian', 'postdiluvian'), (r'\bpost diluvian\b', 'postdiluvian'),
 (r'\bGr[ée]ce\b', 'Grèce'),
 (r'\bRudra Sarvarna\b', 'Rudra Savarna'),
 (r'\bSamba\b', 'Sâmba'),
 (r'\bHiouen Thsang\b', 'Hiouen-Thsang'),
 (r'\(Charlton\)', '(Charton)'),
 (r'\bAiryana-Vaego\b', 'Airyana Vaego'),
 (r'\bPat[âa]l[âa]\b', 'Pâtâla'), (r'\bPâtala\b', 'Pâtâla'),
 (r'\bAxio-Kersa\b', 'Axiokersa'),
 (r'\bVaiswanara\b', 'Vaisvânara'), (r'\bVaisvanara\b', 'Vaisvânara'),
 (r'\bIlda Baoth\b', 'Ilda-Baoth'),
 (r'\bSidhanta\b', 'Siddhanta'),
 (r'\bSaka\b', 'Sâka'),
 (r'\bAsburj\b', 'Ashburj'),
 (r'\bArya-varta\b', 'Aryavarta'),
 (r'\bAgneyastra\b', 'Agneyâstra'),
 (r'\(Viwan\)', '(Viwân)'),
 (r'\bPanini\b', 'Pânini'),
 (r'\bQu-tamy\b', 'Qu-tâmy'),
 (r'\bTar[âa]\b', 'Târâ'), (r'\bTÂRA\b', 'TÂRÂ'),
 (r'\bAgathadæmon\b', 'Agathodæmon'),
 (r'\bMuller\b', 'Müller'),
 (r'\bPrana\b', 'Prâna'),
 (r'\bvice versa\b', 'vice versâ'),
 (r'\bJatayu\b', 'Jâtayu'),
 (r'\bKumaras\b', 'Kumâras'), (r'\bKumara\b', 'Kumâra'),
 (r'\bArmaiti\b', 'Armaita'),
 (r'\bSisumara\b', 'Sisumâra'),
 (r'\bTetract[yi]s\b', 'Tetraktis'),
 (r'\bBois Reymond\b', 'Bois-Reymond'), (r'\bBois Raymond\b', 'Bois-Reymond'),
 (r'\bto day\b', 'to-day'),
 (r'\bHelmholz\b', 'Helmholtz'),
 (r'\bBuchner\b', 'Büchner'),
 (r'\bneolithic\b', 'Neolithic'),
 (r'Dr\. Hartman’s', 'Dr. Hartmann’s'),
 (r'\bVirabhadara\b', 'Virabhadra'),
 (r'Introduction a l’Etude', 'Introduction à l’Etude'),
]

# ---- standing rulings, for the record (the class each sweep applies)
STANDING = []
for was, now, why in [
 ('Mulaprakriti → Mûlaprakriti', 'Mûlaprakriti', r2('Mûlaprakriti','Mûlaprakriti ×1, Mulaprakriti ×6')),
 ('Puranas → Purânas', 'Purânas', r2('Purâna(s)', cnt('Purânas','Puranas','Purâna','Purana','Purânic','Puranic'))),
 ('Kumara(s) → Kumâra(s)', 'Kumâra', r2('Kumâra(s)','Kumâras ×26, Kumaras ×6, Kumâra ×19, Kumara ×8')),
 ('Rakshasas → Râkshasas', 'Râkshasas', r2('Râkshasas','Râkshasas ×13, Rakshasas ×14')),
 ('Prana → Prâna', 'Prâna', r2('Prâna','Prâna ×4, Prana ×8')),
 ('Vach → Vâch', 'Vâch', r2('Vâch','Vâch ×11, Vach ×8')),
 ('Gita → Gitâ', 'Gitâ', r2('Gitâ','Gitâ ×4, Gita ×5')),
 ('Muller → Müller', 'Müller', r2('Müller','Müller ×17, Muller ×8')),
 ('Parasâra, Parasara → Parâsara', 'Parâsara', r3('Parâsara','Parâsara ×11, Parasâra ×6, Parasara ×5')),
 ('Patâla, Patâlâ, Pâtala, Patala → Pâtâla', 'Pâtâla', r3('Pâtâla','Pâtâla ×10, Patâla ×3, Patâlâ ×1, Pâtala ×1, Patala ×1')),
 ('Marisha → Mârishâ', 'Mârishâ', 'Standing ruling 2: the accented form that carries every trace (Mârisha ×2, Marishâ ×2, Mârishâ ×1, Marisha ×1), the Sanskrit Māriṣā.'),
 ('Tara, Tarâ, TÂRA → Târâ', 'Târâ', 'Standing ruling 2: the accented form that carries every trace (Tarâ ×3, TÂRA ×1, Tara ×2), the Sanskrit Tārā.'),
 ('Vaiswanara, Vaisvanara → Vaisvânara', 'Vaisvânara', r3('Vaisvânara','Vaisvânara ×4, Vaiswanara ×3, Vaisvanara ×2')),
 ('Gréce, Grece → Grèce', 'Grèce', 'The second reading prints é for every accent on e and cannot tell é from è; French has Grèce. Read from the word, per the editor\'s rule for a mark the readings cannot settle (Gréce ×7, Grece ×4).'),
 ('Nagal(s) → Nâgal(s)', 'Nâgal', r2('Nâgal(s)','Nâgals ×1, Nagals ×3, Nâgal ×1, Nagal ×1')),
 ('Ulupi → Ulûpi', 'Ulûpi', r2('Ulûpi','Ulûpi ×3, Ulupi ×2')),
 ('Saka → Sâka', 'Sâka', r2('Sâka','Sâka ×5, Saka ×4')),
 ('Samba → Sâmba', 'Sâmba', r2('Sâmba','Sâmba ×3, Samba ×4')),
 ('Panini → Pânini', 'Pânini', r2('Pânini','Pânini ×2, Panini ×5')),
 ('Agneyastra → Agneyâstra', 'Agneyâstra', r2('Agneyâstra','Agneyâstra ×5, Agneyastra ×4')),
 ('Qu-tamy → Qu-tâmy', 'Qu-tâmy', r2('Qu-tâmy','Qu-tâmy ×4, Qu-tamy ×2')),
 ('du Bois Reymond, Raymond → du Bois-Reymond', 'du Bois-Reymond', r3('du Bois-Reymond','Bois-Reymond ×5, Bois Reymond ×3, Bois Raymond ×1')),
 ('Tetractys, Tetractis → Tetraktis', 'Tetraktis', r3('Tetraktis','Tetraktis ×12, Tetractys ×2, Tetractis ×1')),
 ('neolithic → Neolithic', 'Neolithic', r3('Neolithic', cnt('Neolithic','neolithic'))),
 ('post-diluvian, post diluvian → postdiluvian', 'postdiluvian', r3('postdiluvian','postdiluvian ×4, post-diluvian ×3, post diluvian ×2')),
 ('Dhyan Chohanic → Dhyan-Chohanic', 'Dhyan-Chohanic', r3('Dhyan-Chohanic','Dhyan-Chohanic ×7, Dhyan Chohanic ×3')),
 ('Popul-Vuh → Popol-Vuh', 'Popol-Vuh', r3('Popol-Vuh', cnt('Popol-Vuh','Popul-Vuh','Popul-vuh'))),
 ('Haeckel → Hæckel', 'Hæckel', lig('Hæckel')),
 ('Bhodhisatva, Bhodisatva → Bodhisattva', 'Bodhisattva', r3('Bodhisattva','Bodhisattva(s) ×4, Bhodhisatva ×1, Bhodisatva ×1')),
 ('Buchner → Büchner', 'Büchner', r2('Büchner','Büchner ×6, Buchner ×2')),
 ('Jatayu → Jâtayu', 'Jâtayu', r2('Jâtayu','Jâtayu ×1, Jatayu ×2')),
 ('Sisumara → Sisumâra', 'Sisumâra', r2('Sisumâra','Sisumâra ×2, Sisumara ×1')),
 ('Armaiti → Armaita', 'Armaita', r3('Armaita','Armaita ×3, Armaiti ×1')),
 ('vice versa → vice versâ', 'vice versâ', r2('versâ','vice versâ ×7, vice versa ×2')),
 ('Ilda Baoth → Ilda-Baoth', 'Ilda-Baoth', r3('Ilda-Baoth','Ilda-Baoth ×7, Ilda Baoth ×1')),
 ('Viwan → Viwân', 'Viwân', r2('Viwân','Viwân(s) ×4, Viwan ×1')),
 ('TWOFOLD → TWO-FOLD', 'TWO-FOLD', r3('TWO-FOLD','TWO-FOLD ×3, TWOFOLD ×1')),
]:
    STANDING.append(dict(quote=was, correction=now, because=why))

# ---- resolve the per-query decisions against the waiting list
byleaf = defaultdict(list)
for w in W: byleaf[w['leaf']].append(w)
rulings, seen = [], set()
for d in D:
    hits = [w for w in byleaf[d['leaf']] if w['quote'].startswith(d['prefix'])]
    assert len(hits) == 1, (d['leaf'], d['prefix'], len(hits))
    key = (d['leaf'], hits[0]['quote'])
    assert key not in seen, key
    seen.add(key)
    rulings.append(dict(leaf=d['leaf'], quote=hits[0]['quote'], decision=d['decision'], correction=d['correction'], because=d['because']))
proposals = []
for leaf, pre, dec, corr, why in PROPOSE:
    hits = [w for w in byleaf[leaf] if w['quote'].startswith(pre)]
    assert len(hits) == 1, (leaf, pre, len(hits))
    proposals.append(dict(leaf=leaf, quote=hits[0]['quote'], decision=dec, **({'correction': corr} if corr else {}), because=why))
left = [w for w in W if (w['leaf'], w['quote']) not in seen]
print(f"waiting {len(W)}: ruled {len(rulings)} (as-printed {sum(r['decision']=='as-printed' for r in rulings)}, corrected {sum(r['decision']=='corrected' for r in rulings)}, noted {sum(r['decision']=='noted' for r in rulings)}); proposals on {len({(p['leaf'],p['quote']) for p in proposals})} queries; unaccounted {len(left)}")
for w in left: print('  LEFT', w['leaf'], w['quote'][:60])

# ---- the sweeps, one phrase per occurrence, unique over the plain corpus
def phrase(text, start, end):
    for pad in (28, 45, 70, 110):
        a = max(0, start - pad); b = min(len(text), end + pad)
        while a > 0 and text[a-1] != ' ': a -= 1
        while b < len(text) and text[b] != ' ': b += 1
        ph = text[a:b]
        n = sum(t.count(ph) for t in P.values())
        if n == 1: return ph, a, b
    return None, None, None
plan, dupes = [], []
for pat, rep in SWEEPS:
    for k, t in P.items():
        for m in re.finditer(pat, t):
            ph, a, b = phrase(t, m.start(), m.end())
            if ph is None: dupes.append((pat, k, t[max(0,m.start()-40):m.end()+40])); continue
            now = ph[:m.start()-a] + re.sub(pat, rep, m.group()) + ph[m.end()-a:]
            if now == ph: continue
            plan.append(dict(was=ph, now=now, where=k, form=m.group(), to=re.sub(pat, rep, m.group())))
print('sweeps', len(plan), 'unresolvable', len(dupes))
for d in dupes: print('  DUPE', d)
json.dump(dict(rulings=rulings, proposals=proposals, sweeps=plan, standing=STANDING), open('/tmp/claude-0/sdk2/decisions.json','w'), ensure_ascii=False, indent=1)
from collections import Counter as Ctr
print(Ctr((s['form'], s['to']) for s in plan).most_common())
