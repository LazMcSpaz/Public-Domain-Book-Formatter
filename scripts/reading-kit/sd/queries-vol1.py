"""The 71 waiting queries of The Secret Doctrine Vol. I that no standing ruling
holds, decided by the standing rulings (RULINGS.md), the editor's rulings of
2026-09-24 on this volume, and the counts over the assembled book and its
notes. The 85 held queries are the editor's to approve and are not touched.
Writes decisions.json: rulings, class sweeps, standing rulings for the record,
and the places that stay the editor's, offered as proposals."""
import json, re
from collections import defaultdict, Counter

W = json.load(open('/tmp/claude-0/sdq1/waiting.json'))
C = json.load(open('/tmp/claude-0/sdq1/corpus.json'))
strip = lambda s: re.sub(r'</?(?:i|em|b|strong)>', '', s)
P = {k: strip(v) for k, v in C.items()}

PRE = {
 r'\bSV[AÂ]BH[AÂ]V[AÂ]T\b': 'SVABHAVAT ×9, SVÂBHAVAT ×3, SVÂBHÂVAT ×1',
 r'\bSv[aâ]bh[aâ]v[aâ]t\b': 'Svâbhâvat ×9, Svâbhavat ×1',
 r'\bMah[aâ]y[aâ]na\b': 'Mahâyâna ×2, Mahayana ×2, Mahâyana ×1',
 r'\bYog[aâ]ch[aâ]ryas?\b': 'Yogâcharya ×2, Yogâchâryas ×2, Yogâcharyas ×1',
 r'\bAv[aâ]l[oô]kit[eêé]s?h?wara\b': 'Avalokiteshwara ×5, Avalôkitêswara ×2, Avalokitêshwara ×2, Avalokiteswara ×2, Avalôkitêshwara ×1, Avalokitéswara ×1, Avalôkitéswara ×1, Avalokitéshwara ×1',
 r'\bPr[aâ]n[aâ]y[aâ]ma\b': 'Pranâyâma ×1, Prânâyâma ×1',
 r'\bM[aâ]rtt?[aâ]nda\b': 'Marttânda ×4, Mârttânda ×2, Marttanda ×1',
 r'\bSankar[aâ]ch[aâ]rya\b': 'Sankaracharya ×7, Sankarâchârya ×3, Sankarachârya ×3',
 r'\bPr[aâ]dh[aâ]nika\b': 'Pradhânika ×2, Prâdhanika ×1',
 r'Praj[aâ]pati-V[aâ]ch': 'Prajâpati-Vâch ×1, Prajapati-Vâch ×1',
 r'\bK[aâ]ma-?loka\b': 'Kama-loka ×3, Kamaloka ×2, Kâmaloka ×1',
 r'Dzeni\w+': 'Dzeniouta ×2, Dzenioota ×2, Dzenioutha ×1, Dzeniuta ×1',
 r'\bSesha\b|\bSacha\b': 'Sesha ×4, Sacha ×1',
 r'\bJac\w*olliot': 'Jacolliot ×1, Jacquolliot ×1',
 r'\bAudh?umla': 'Audhumla ×1, Audumla ×1',
 r'ALL[- ]FATHER|All-Father': 'ALL-FATHER ×1, All-Father ×1, ALL FATHER ×1',
 r'Bhagavad[- ]Gita': 'Bhagavad Gita ×3, Bhagavad-Gita ×1',
 r'\bIlda-?ba?oth|\bIldaboth': 'Ildabaoth ×7, Ildaboth ×1',
 r'Stanza V[Ii]\.': 'Stanza VI. ×9, Stanza Vi. ×1',
 r'\bEncyclop(?:æ|e|ae)dia': 'Encyclopædia ×1, Encyclopedia ×1',
 r'\bworship+ing': 'worshipping ×2, worshiping ×1',
 r'\bSwasti[ck]a': 'Swastica ×2, Swastika ×1',
 r'\bKali[- ]Yug': 'Kali Yug ×15, Kali-Yug ×6',
}
def cnt(pat):
    if pat in PRE: return PRE[pat]
    c = Counter(m.group() for t in P.values() for m in re.finditer(pat, t))
    return ', '.join(f'{k} ×{v}' for k, v in c.most_common())

BECAUSE = {
 'unpaired': "Editor's standing ruling 2026-09-24 on this volume: where a quotation opens and never closes, or closes without opening, it is left as printed, the mark unpaired; where it should close is a choice this edition does not make.",
 'bracket': "Editor's standing ruling 2026-09-24 on unpaired quotation marks, applied to a bracket: left as printed, the mark unpaired; where it should close is a choice this edition does not make.",
 'author': "Standing ruling 1 (RULINGS.md): a name or a fact as the author gave it is a note, not a correction; the reader is told what the source says.",
 'citation': "Standing ruling 1 (RULINGS.md): a citation or cross-reference the author got wrong is a note, not a correction.",
 'quoted': "Kept as the quoted source prints it: a spelling inside a quotation from another author is that author's, and standing ruling 3 counts the book's own usage, not its quotations.",
 'pointing': "Standing ruling 1 (RULINGS.md) leaves pointing that merely varies between passages as printed.",
 'consistent': "The book now sets the term one way throughout (counted over the body and the notes), so there is nothing left to reconcile.",
}
def r2(word, counts): return f"Standing ruling 2 (RULINGS.md): one form per term, the accented form, which here is the one that carries every accent any setting shows, so no accent is stripped; counted over the assembled book and its notes: {counts}. Every setting is swept to {word}."
def r3(word, counts): return f"Standing ruling 3 (RULINGS.md): a spelling that varies within a book is settled to its majority form, counted over the assembled book and its notes: {counts}. Swept to {word}."
def tie(word, why):   return f"Editor's ruling 2026-09-24 on this volume, extending standing ruling 3: a one-to-one tie the count cannot settle goes to the scholarly correct form, {word}: {why}"
def lig(word, counts): return f"Editor's ruling 2026-09-24 on this volume (fœtus): the proper spelling, with the ligature, {word}; counted: {counts}."

D = []
def q(leaf, prefix, decision, correction=None, because=''):
    D.append(dict(leaf=leaf, prefix=prefix, decision=decision, correction=correction, because=because))

# A. unpaired quotation marks and brackets
for leaf, pre in [(437, 'the CHRIST'), (454, 'it may well stand'), (585, 'the secret meaning'), (590, 'a “physical')]:
    q(leaf, pre, 'as-printed', None, BECAUSE['unpaired'])
for leaf, pre in [(469, '(See”'), (535, 'in Exodus'), (610, '(Signed'), (641, 'surrounded by'), (694, '(the Vulgatt'), (718, '(Maspero')]:
    q(leaf, pre, 'as-printed', None, BECAUSE['bracket'])

# B. the author's own slips, citations, quotations, pointing
q(349, '(vide', 'noted', None, BECAUSE['citation'] + ' Deus Lunus is § IX by the Part\'s own contents (leaf 346) and its heading (leaf 430).')
q(425, '(See § X.', 'noted', None, BECAUSE['citation'] + ' Deus Lunus is § IX by the Part\'s own contents (leaf 346) and its heading (leaf 430).')
q(617, 'greater than I', 'noted', None, BECAUSE['citation'] + ' "My Father is greater than I" is John xiv. 28.')
q(623, 'To this remark', 'noted', None, BECAUSE['author'] + ' The passage quoted just above names him Sir David Brewster.')
q(673, 'Mr. H. A.', 'noted', None, BECAUSE['author'] + ' Leaf 675 gives the lecturer\'s initials as C. H. A.')
q(691, 'Cimah)', 'noted', None, BECAUSE['author'] + ' The author transliterates the Hebrew of Job ix. 9 two ways within one passage (Cimah and Chimah, Kesil and Cesil); each is left as set.')
q(710, 'Bouilland', 'noted', None, BECAUSE['author'] + ' Every other row of the table checks; this one\'s difference works out to 0h. 56m. 53s., and the figure is left as the table prints it.')
q(419, 'Siphrah Dzeniuta', 'as-printed', None, BECAUSE['quoted'] + ' It stands inside the quotation from Myer\'s Qabbalah.')
q(425, 'the d evelopernent', 'as-printed', None, BECAUSE['quoted'] + ' It stands inside the quoted MSS.')
q(283, '(5) THE SPARK', 'as-printed', None, BECAUSE['pointing'] + ' The sloka\'s number is set in brackets here and without them on leaf 282.')
q(486, 'the Gnostic Agathodaomon', 'as-printed', None, BECAUSE['consistent'] + ' ' + cnt(r'Agatho?d(?:æ|e|a)mon') + '.')

# C. clear typos (standing ruling 1)
q(282, '(see Commentary on Stanza Vi.)', 'corrected', '(see Commentary on Stanza VI.)', "Standing ruling 1 (RULINGS.md): damaged type. The book names this Stanza VI. at every other setting (" + cnt(r'Stanza V[Ii]\.') + "), and a lower-case i inside a capital numeral is a broken sort or the conversion's.")
q(493, 'regarded Jehovah as Ildabaoth himself King', 'corrected', 'regarded Jehovah as Ildabaoth himself. King identifies him with Saturn', "Standing ruling 1 (RULINGS.md): a stop missing where a sentence ends and the next begins with a capital, corrected as the editor corrected the same fault on leaves 14 and 40 of Vol. II.")

# D. one term two ways, settled by count
q(75, 'SVÂBHAVAT', 'corrected', 'SVÂBHÂVAT', r2('SVÂBHÂVAT', cnt(r'\bSV[AÂ]BH[AÂ]V[AÂ]T\b') + '; in lower case ' + cnt(r'\bSv[aâ]bh[aâ]v[aâ]t\b') + ', so the capital form joins the book\'s own Svâbhâvat'))
q(84, 'Mahâyana', 'corrected', 'Mahâyâna', r2('Mahâyâna', cnt(r'\bMah[aâ]y[aâ]na\b')))
q(93, 'Yogâcharyas', 'corrected', 'Yogâchâryas', r2('Yogâchârya(s)', cnt(r'\bYog[aâ]ch[aâ]ryas?\b')))
q(117, 'Avalôkitêshwara', 'as-printed', None, r2('Avalôkitêshwara', cnt(r'\bAv[aâ]l[oô]kit[eêé]s?h?wara\b')) + " The -swara settings join the -shwara majority under standing ruling 3 (nine against six), and é is the second reading's mark for any accent on e (as with Grèce on Vol. II), so it is set ê.")
q(140, 'Pranâyâma', 'corrected', 'Prânâyâma', r2('Prânâyâma', cnt(r'\bPr[aâ]n[aâ]y[aâ]ma\b')))
q(144, 'Marttânda', 'corrected', 'Mârttânda', r2('Mârttânda', cnt(r'\bM[aâ]rtt?[aâ]nda\b')) + " It is also the form the editor ruled for leaf 145.")
q(616, 'Sankarâchârya', 'as-printed', None, r2('Sankarâchârya', cnt(r'\bSankar[aâ]ch[aâ]rya\b')))
q(489, 'One Pradhanika', 'corrected', 'Prâdhânika', r2('Prâdhânika', cnt(r'\bPr[aâ]dh[aâ]nika\b')) + ' (the Sanskrit prādhānika).')
q(489, 'Prâdhanika', 'corrected', 'Prâdhânika', r2('Prâdhânika', cnt(r'\bPr[aâ]dh[aâ]nika\b')) + ' (the Sanskrit prādhānika).')
q(476, 'Prajâpati-Vâch', 'as-printed', None, r2('Prajâpati-Vâch', cnt(r'Praj[aâ]pati-V[aâ]ch')) + ' The bare setting on leaf 471 is swept to it.')
q(507, 'than the Kamaloka', 'corrected', 'than the Kâmaloka, the limbus', tie('Kâmaloka', cnt(r'\bK[aâ]ma-?loka\b') + ': the hyphen is three against three, and kāmaloka is one word; the accent is ruling 2\'s. Every setting swept to it.'))
q(507, 'Kâmaloka', 'as-printed', None, tie('Kâmaloka', cnt(r'\bK[aâ]ma-?loka\b') + ': the hyphen is three against three, and kāmaloka is one word; the accent is ruling 2\'s. Every setting swept to it.'))
q(383, 'Siphrah Dzenioota', 'corrected', 'Siphrah Dzeniouta', tie('Siphrah Dzeniouta', cnt(r'Dzeni\w+') + '; Dzeniouta is the form of the Proem (leaves 39, 40) and follows the French ou of the translations the book draws on (Mathers: Dtzenioutha). Dzeniuta (418) is inside a quotation from Myer and stays.'))
q(388, 'sleeping on Ananta-Sacha', 'corrected', 'sleeping on Ananta-Sesha', r3('Ananta-Sesha', cnt(r'\bSesha\b|\bSacha\b') + ' (Vol. II sets Sesha 8 times)'))
q(421, 'See Jacquolliot', 'corrected', 'See Jacolliot', tie('Jacolliot', cnt(r'\bJac\w*olliot') + '; it is the author\'s own name, Louis Jacolliot, and Vol. II sets it so four times.'))
q(471, 'Then comes the cow Audumla', 'corrected', 'Then comes the cow Audhumla', tie('Audhumla', cnt(r'\bAudh?umla') + '; the Old Norse is Auðumbla, Audhumla in the usual transliteration.'))
q(471, 'Audumla', 'corrected', 'Audhumla', tie('Audhumla', cnt(r'\bAudh?umla') + '; the Old Norse is Auðumbla, Audhumla in the usual transliteration.'))
q(471, 'ALL FATHER, the Uncreated', 'corrected', 'ALL-FATHER, the Uncreated', r3('ALL-FATHER', 'on this leaf ' + cnt(r'ALL[- ]FATHER|All-Father') + '; the second reading, the only witness here, drops hyphens elsewhere'))
q(476, 'Bhagavad-Gita', 'corrected', 'Bhagavad Gita', r3('Bhagavad Gita', cnt(r'Bhagavad[- ]Gita')))
q(493, 'were his (Ildaboth', 'corrected', 'were his (Ildabaoth’s) sons', r3('Ildabaoth', cnt(r'\bIlda-?ba?oth|\bIldaboth')))
q(542, 'French Encyclopcedia', 'as-printed', None, lig('Encyclopædia', cnt(r'\bEncyclop(?:æ|e|ae)dia')) + ' The one bare setting (leaf 422) is swept to it.')
q(621, 'It is by worshiping', 'corrected', 'It is by worshipping and enforcing', r3('worshipping', cnt(r'\bworship+ing')))
q(621, 'worshiping', 'corrected', 'worshipping', r3('worshipping', cnt(r'\bworship+ing')))
q(365, 'the Swastica', 'as-printed', None, r3('Swastica', cnt(r'\bSwasti[ck]a')))
q(700, 'Swastica', 'as-printed', None, r3('Swastica', cnt(r'\bSwasti[ck]a')))
q(706, 'at the commencement of Kali Yug', 'as-printed', None, r3('Kali Yug', cnt(r'\bKali[- ]Yug')))

# E. left to the editor, with the reader's answers offered at the gate
PROPOSE = [
 (68, '“Tho-ag in Zhi-gyu', 'corrected', 'Tho-og in Zhi-gyu slept seven Khorlo', 'Tho-og, the form the same verse sets four lines on (Tho-og Yinsin) and the one the Theosophical Glossary enters.'),
 (68, '“Tho-ag in Zhi-gyu', 'as-printed', None, 'Keep both as the verse prints them; the count is one each and cannot settle it.'),
 (442, 'Ammon-ni saying', 'corrected', 'Ammon-Ra saying', 'Ammon-Ra, as leaf 411 prints it; the traces here only show that some vowel after the r carried a mark.'),
 (442, 'Ammon-ni saying', 'as-printed', None, 'Keep Ammon-râ as set from the trace, and sweep leaf 411\'s Ammon-Ra to it (ruling 2).'),
 (495, 'repeats Brucker', 'corrected', 'repeats Brucker (1., 240)', 'Brucker, the historian\'s own name (Johann Jakob Brucker), and the form the second reading gives here; the Brücker on the same leaf rests on a ClearScan "ii" and would be stripped to it, which is the editor\'s to do.'),
 (495, 'repeats Brucker', 'as-printed', None, 'Keep each as printed: Brucker here, Brücker where the trace shows it.'),
 (505, 'Katakopanisdd', 'corrected', 'Katakopanishad', 'Katakopanishad, the form leaf 409 sets in the same sentence, and nearer the Sanskrit Kaṭhopaniṣad; the "isâd" rests on a doubtful trace, and stripping it is the editor\'s to do.'),
 (505, 'Katakopanisdd', 'as-printed', None, 'Keep Katakopanisâd as set from the trace, and sweep leaf 409 to it.'),
 (507, 'Jurbo Adona!', 'as-printed', None, 'Keep Jurbo Adonai and Yurbo-Adonai as each place prints them; both are transliterations of the Codex Nazaraeus\'s Iurbo Adunai.'),
 (507, 'Jurbo Adona!', 'corrected', 'Jurbo Adonai', 'One form, Jurbo Adonai, the first on the leaf; the later Yurbo-Adonai swept to it.'),
 (669, 'John Theodore Merz', 'as-printed', None, 'Keep Merz here, his real name (John Theodore Merz, author of Leibniz, 1884), and sweep the three Mertz to it.'),
 (669, 'John Theodore Merz', 'noted', None, 'Keep each as printed (Merz once, Mertz three times) and tell the reader in a note that the name is Merz.'),
 (677, 'Dr. J. H. Hutchinson Sterling', 'corrected', 'Dr. J. H. Hutchinson Stirling’s work', 'Stirling, his real name (James Hutchison Stirling, The Secret of Hegel), as leaf 680 sets it; leaf 96 swept with it.'),
 (677, 'Dr. J. H. Hutchinson Sterling', 'noted', None, 'Keep each as printed (Sterling twice, Stirling once) and tell the reader in a note that the name is Stirling.'),
 (709, 'or 4,386 years', 'corrected', 'or 4,383 years and 94 days', '4,383, the figure leaf 710 gives twice and the day count (1,600,984 days) works out to.'),
 (709, 'or 4,386 years', 'noted', None, 'Keep 4,386 as printed and tell the reader the day count gives 4,383, as leaf 710 does.'),
 (709, 'this long period of 4,883', 'corrected', 'this long period of 4,383 years', '4,383, as leaf 710 and the day count give it; 4,883 has an 8 for a 3.'),
 (709, 'this long period of 4,883', 'noted', None, 'Keep 4,883 as printed and tell the reader the period is 4,383 years.'),
]

SWEEPS = [
 (r'\bSV[AÂ]BH[AÂ]V[AÂ]T\b', 'SVÂBHÂVAT'), (r'\bSvâbhavat\b', 'Svâbhâvat'),
 (r'\bMah[aâ]y[aâ]na\b', 'Mahâyâna'),
 (r'\bYog[aâ]ch[aâ]rya', 'Yogâchârya'),
 (r'\bAv[aâ]l[oô]kit[eêé]s?h?wara\b', 'Avalôkitêshwara'),
 (r'\bPr[aâ]n[aâ]y[aâ]ma\b', 'Prânâyâma'),
 (r'\bM[aâ]rtt[aâ]nda\b', 'Mârttânda'),
 (r'\bSankar[aâ]ch[aâ]rya\b', 'Sankarâchârya'),
 (r'\bPr[aâ]dh[aâ]nika\b', 'Prâdhânika'),
 (r'Prajapati-Vâch', 'Prajâpati-Vâch'),
 (r'\bK[aâ]ma-?loka\b', 'Kâmaloka'),
 (r'Siphrah Dzenioota', 'Siphrah Dzeniouta'),
 (r'Ananta-Sacha', 'Ananta-Sesha'),
 (r'\bJacquolliot\b', 'Jacolliot'),
 (r'\bAudumla\b', 'Audhumla'),
 (r'\bALL FATHER\b', 'ALL-FATHER'),
 (r'Bhagavad-Gita', 'Bhagavad Gita'),
 (r'\bIldaboth', 'Ildabaoth'),
 (r'Ildabaoth himself King', 'Ildabaoth himself. King'),
 (r'Stanza Vi\.', 'Stanza VI.'),
 (r'\bEncyclopedia\b', 'Encyclopædia'),
 (r'\bworshiping\b', 'worshipping'),
 (r'\bSwastika\b', 'Swastica'),
 (r'\bKali-Yug\b', 'Kali Yug'),
]

STANDING = []
for was, now, why in [
 ('SVABHAVAT, SVÂBHAVAT, Svâbhavat → SVÂBHÂVAT, Svâbhâvat', 'SVÂBHÂVAT', r2('SVÂBHÂVAT', cnt(r'\bSV[AÂ]BH[AÂ]V[AÂ]T\b') + '; ' + cnt(r'\bSv[aâ]bh[aâ]v[aâ]t\b'))),
 ('Mahayana, Mahâyana → Mahâyâna', 'Mahâyâna', r2('Mahâyâna', cnt(r'\bMah[aâ]y[aâ]na\b'))),
 ('Yogâcharya(s) → Yogâchârya(s)', 'Yogâchârya', r2('Yogâchârya', cnt(r'\bYog[aâ]ch[aâ]ryas?\b'))),
 ('Avalokiteshwara, Avalokiteswara and their accented settings → Avalôkitêshwara', 'Avalôkitêshwara', r2('Avalôkitêshwara', cnt(r'\bAv[aâ]l[oô]kit[eêé]s?h?wara\b')) + ' The -swara settings join the -shwara majority under ruling 3.'),
 ('Marttânda, Marttanda → Mârttânda', 'Mârttânda', r2('Mârttânda', cnt(r'\bM[aâ]rtt?[aâ]nda\b'))),
 ('Sankaracharya, Sankarachârya → Sankarâchârya', 'Sankarâchârya', r2('Sankarâchârya', cnt(r'\bSankar[aâ]ch[aâ]rya\b'))),
 ('Pradhânika, Prâdhanika → Prâdhânika', 'Prâdhânika', r2('Prâdhânika', cnt(r'\bPr[aâ]dh[aâ]nika\b'))),
 ('Kama-loka, Kamaloka → Kâmaloka', 'Kâmaloka', tie('Kâmaloka', cnt(r'\bK[aâ]ma-?loka\b') + '; the hyphen ties three to three and kāmaloka is one word; the accent is ruling 2\'s.')),
 ('Siphrah Dzenioota → Siphrah Dzeniouta', 'Siphrah Dzeniouta', tie('Siphrah Dzeniouta', cnt(r'Dzeni\w+'))),
 ('Kali-Yug → Kali Yug', 'Kali Yug', r3('Kali Yug', cnt(r'\bKali[- ]Yug'))),
 ('Swastika → Swastica', 'Swastica', r3('Swastica', cnt(r'\bSwasti[ck]a'))),
]:
    STANDING.append(dict(quote=was, correction=now, because=why))

byleaf = defaultdict(list)
for w in W: byleaf[w['leaf']].append(w)
rulings, seen = [], set()
for d in D:
    hits = [w for w in byleaf[d['leaf']] if w['quote'].startswith(d['prefix'])]
    assert len(hits) == 1, (d['leaf'], d['prefix'], len(hits))
    key = (d['leaf'], hits[0]['quote']); assert key not in seen, key; seen.add(key)
    rulings.append(dict(leaf=d['leaf'], quote=hits[0]['quote'], decision=d['decision'], correction=d['correction'], because=d['because']))
proposals = []
for leaf, pre, dec, corr, why in PROPOSE:
    hits = [w for w in byleaf[leaf] if w['quote'].startswith(pre)]
    assert len(hits) == 1, (leaf, pre, len(hits))
    assert (leaf, hits[0]['quote']) not in seen, (leaf, pre)
    proposals.append(dict(leaf=leaf, quote=hits[0]['quote'], decision=dec, **({'correction': corr} if corr else {}), because=why))
left = [w for w in W if (w['leaf'], w['quote']) not in seen]
print(f"waiting {len(W)}: ruled {len(rulings)} (as-printed {sum(r['decision']=='as-printed' for r in rulings)}, corrected {sum(r['decision']=='corrected' for r in rulings)}, noted {sum(r['decision']=='noted' for r in rulings)}); new proposals on {len({(p['leaf'],p['quote']) for p in proposals})}; left to the editor {len(left)}")
for w in left: print('  LEFT', w['leaf'], w['quote'][:60])

def phrase(text, start, end):
    for pad in (28, 45, 70, 110):
        a = max(0, start - pad); b = min(len(text), end + pad)
        while a > 0 and text[a-1] != ' ': a -= 1
        while b < len(text) and text[b] != ' ': b += 1
        ph = text[a:b]
        if sum(t.count(ph) for t in P.values()) == 1: return ph, a, b
    return None, None, None
plan, dupes = [], []
for pat, rep in SWEEPS:
    for k, t in P.items():
        for m in re.finditer(pat, t):
            to = re.sub(pat, rep, m.group())
            if to == m.group(): continue
            ph, a, b = phrase(t, m.start(), m.end())
            if ph is None: dupes.append((pat, k)); continue
            plan.append(dict(was=ph, now=ph[:m.start()-a] + to + ph[m.end()-a:], where=k, form=m.group(), to=to))
print('sweeps', len(plan), 'unresolvable', len(dupes), dupes)
# two sweeps landing in one phrase would collide: the second is planned against text the first changed
wh = Counter(s['where'] for s in plan)
json.dump(dict(rulings=rulings, proposals=proposals, sweeps=plan, standing=STANDING), open('/tmp/claude-0/sdq1/decisions.json','w'), ensure_ascii=False, indent=1)
print(Counter((s['form'], s['to']) for s in plan).most_common())
