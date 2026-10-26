import type { ReactNode } from "react";
import { SHARED_END, SHARED_START } from "../lib/rules";
import type { ErrorCode, ErrorInfo } from "../lib/types";
import type { Messages } from "./en";

/** `1 skill`, `2 skills`: in French, 0 and 1 take the singular. */
const count = (n: number, one: string, many: string) => `${n.toLocaleString("fr")} ${n <= 1 ? one : many}`;

/** "A", "A et B", "A, B et C". */
const list = (items: string[]) => new Intl.ListFormat("fr", { type: "conjunction" }).format(items);

/** The French texts of the app, with the same keys as the English ones. */
export const fr: Messages = {
  common: {
    cancel: "Annuler",
    close: "Fermer",
    open: "Ouvrir",
    none: "Aucun",
    actions: "Actions",
    actionsFor: (name: string) => `Actions pour ${name}`,
    clearSearch: "Effacer la recherche",
    save: "Enregistrer",
    discard: "Abandonner",
    unsaved: "Modifications non enregistrées",
    notSaved: (what: string) => `Vos modifications des ${what} ne sont pas enregistrées.`,
    notFound: (agent: string) => `${agent} est introuvable sur cet ordinateur`,
    about: (what: string, text: string) => `${what} : ${text}`,
  },
  toast: {
    region: "Notifications",
    undo: "Annuler",
    undoing: "Annulation…",
    undone: "Annulé.",
    undoFailed: (err: string) => `Impossible d’annuler : ${err}`,
    dismiss: "Fermer",
  },
  drawer: {
    sections: "Sections",
  },
  palette: {
    label: "Palette de commandes",
    placeholder: "Aller à une page, trouver un serveur ou un skill, lancer une commande",
    commands: "Commandes",
    nothing: (query: string) => `Rien ne correspond à « ${query} ».`,
    more: (n: number) => `${n} de plus : précisez votre recherche.`,
  },
  test: {
    starting: "Démarrage du serveur… Le premier lancement peut être long s’il doit être téléchargé.",
    works: (server: string, time: string) => `Il fonctionne${server ? ` : ${server}` : ""}, réponse en ${time}.`,
    noTools: "Il n’a aucun outil, seulement des prompts ou des ressources.",
    tools: (n: number) => `${count(n, "outil", "outils")}.`,
    output: "Sortie du serveur",
  },
  launcher: {
    title: (n: number) =>
      n <= 1 ? "1 serveur protégé ne démarre plus" : `${n} serveurs protégés ne démarrent plus`,
    gone: (path: ReactNode, others: number): ReactNode => (
      <>
        Leur agent lance le lanceur <code>agentdeck</code> depuis {path}
        {others > 0 && ` et ${count(others, "autre emplacement", "autres emplacements")}`}, qui n’existe plus : AgentDeck
        a sans doute été déplacé ou réinstallé.
      </>
    ),
    repairHint: "Réparer les fait pointer vers cette copie ; leurs secrets restent dans le trousseau.",
    reinstall: "Réinstallez AgentDeck, puis réparez-les ici.",
    repair: "Réparer",
    repairing: "Réparation…",
    repaired: (n: number) =>
      `${count(n, "serveur protégé réparé", "serveurs protégés réparés")}. Redémarrez les agents qui les utilisent.`,
  },
  update: {
    available: (version: string, current: string) =>
      `AgentDeck ${version} est disponible (vous avez la ${current}).`,
    install: "Installer et redémarrer",
    later: "Plus tard",
    downloading: "Téléchargement…",
    restarting: "Redémarrage…",
    failed: (err: string) => `La mise à jour a échoué : ${err}`,
  },
  diff: {
    label: "Différences",
    unchanged: (n: number) => count(n, "ligne inchangée", "lignes inchangées"),
  },
  chart: {
    label: "Coût estimé par jour. Utilisez les flèches pour lire chaque jour.",
    noUsage: "Aucune utilisation",
  },
  markdown: {
    empty: "Vide",
    image: "Image",
  },
  editor: {
    phrases: {
      Find: "Rechercher",
      Replace: "Remplacer",
      next: "suivant",
      previous: "précédent",
      all: "tout",
      "match case": "respecter la casse",
      "by word": "mot entier",
      regexp: "expression régulière",
      replace: "remplacer",
      "replace all": "tout remplacer",
      close: "fermer",
      "current match": "occurrence actuelle",
      "replaced $ matches": "$ occurrences remplacées",
      "replaced match on line $": "occurrence remplacée à la ligne $",
      "on line": "à la ligne",
      "Go to line": "Aller à la ligne",
      go: "aller",
      "Control character": "Caractère de contrôle",
      "Selection deleted": "Sélection supprimée",
      "folded code": "code replié",
      unfold: "déplier",
      to: "à",
    },
  },
  settings: {
    title: "Paramètres",
    description: "L’apparence d’AgentDeck, où il trouve chaque agent, et les fichiers qu’il conserve.",
    appearance: "Apparence",
    theme: "Thème",
    themes: { system: "Comme le système", light: "Clair", dark: "Sombre" },
    language: "Langue",
    systemLanguage: "Comme le système",
    updates: "Mises à jour",
    checkedAtStart: "Vérifiées au démarrage de l’app.",
    checking: "Vérification…",
    latest: "C’est la dernière version.",
    versionAvailable: (version: string) => `La version ${version} est disponible.`,
    checkFailed: (err: string) => `Impossible de vérifier les mises à jour : ${err}`,
    releaseNotes: "Notes de version",
    checkNow: "Vérifier maintenant",
    folders: "Dossiers des agents",
    foldersHint: (
      <>
        Où AgentDeck lit et écrit les fichiers de chaque agent. Claude Code et Codex utilisent un autre dossier quand{" "}
        <code>CLAUDE_CONFIG_DIR</code> ou <code>CODEX_HOME</code> est défini, et AgentDeck les suit. Choisissez le dossier
        ici quand l’app ne voit pas ces variables, comme lorsqu’elle est ouverte depuis le Finder de macOS.
      </>
    ),
    setBy: (variable: string) => `Défini par ${variable}.`,
    chosen: "Choisi dans AgentDeck.",
    change: "Changer…",
    useDefault: "Réinitialiser",
    folderChosen: (agent: string) => `AgentDeck lit maintenant les fichiers de ${agent} dans le dossier choisi.`,
    folderReset: (agent: string) => `AgentDeck lit de nouveau les fichiers de ${agent} dans son dossier par défaut.`,
    protected: "Serveurs protégés",
    launcher: "Lanceur",
    launcherMissing: "Introuvable : réinstallez AgentDeck.",
    launcherHint: (
      <>
        Les serveurs dont les clés sont dans le trousseau démarrent par cette commande <code>agentdeck</code>.
      </>
    ),
    backups: "Sauvegardes",
    backupsHint: (n: number, kept: number) =>
      `${count(n, "sauvegarde", "sauvegardes")}. Chaque écriture garde la version précédente ; les ${kept} dernières de chaque fichier sont conservées.`,
    trash: "Corbeille des skills",
    trashEmpty: "Vide.",
    trashHint: (n: number) =>
      `${count(n, "skill supprimé ou remplacé", "skills supprimés ou remplacés")}, à restaurer depuis la page Skills.`,
    emptyTrash: "Vider la corbeille",
    emptyTitle: "Vider la corbeille des skills ?",
    deleteForGood: "Supprimer définitivement",
    emptyBody: (n: number) =>
      `${n <= 1 ? `${n} skill est supprimé` : `${n} skills sont supprimés`} définitivement. Impossible de revenir en arrière.`,
    trashEmptied: (n: number) =>
      `${count(n, "skill supprimé", "skills supprimés")} définitivement.`,
  },
  mcp: {
    title: "Serveurs MCP",
    description:
      "Chaque ligne est un serveur, chaque colonne un agent. Ajoutez un serveur à un autre agent en un clic : ses réglages et ses secrets sont copiés pour vous.",
    search: "Rechercher des serveurs",
    searchLabel: "Rechercher des serveurs par nom, commande ou URL",
    searchHint: "La recherche porte sur les noms, les commandes et les URL.",
    noMatch: (query: string) => `Aucun serveur ne correspond à « ${query} »`,
    add: "Ajouter un serveur",
    addTitle: "Ajouter un serveur MCP",
    addSubtitle: "À un agent ou à plusieurs à la fois.",
    server: "Serveur",
    emptyTitle: "Aucun serveur MCP configuré",
    empty: "Ajoutez-en un avec le bouton ci-dessus, ou installez-en un dans n’importe quel agent : il apparaîtra ici.",
    details: "Détails",
    differences: "Différences",
    backups: "Sauvegardes",
    addEverywhere: "Ajouter à tous les agents",
    unsynced: (n: number) => `Non synchronisés (${n})`,
    unsyncedTip: "N’afficher que les serveurs absents d’un agent installé, ou configurés différemment",
    allInSync: "Tous les serveurs sont synchronisés",
    allInSyncHint: "Chaque agent installé a tous les serveurs, configurés de la même façon.",
    showAll: "Afficher tous les serveurs",
    sync: "Tout synchroniser",
    syncTip: "Ajouter chaque serveur aux agents installés qui ne l’ont pas",
    syncTitle: "Ajouter les serveurs manquants à tous les agents installés ?",
    syncConfirm: (n: number) => `Ajouter ${count(n, "copie", "copies")}`,
    syncLine: (name: ReactNode, from: string, to: string): ReactNode => (
      <>
        {name} de {from}, vers {to}
      </>
    ),
    syncHint: "Les réglages et les secrets sont copiés sans être affichés. Un seul Annuler les retire tous.",
    syncDiffering: (names: string) => `Les copies différentes, comme ${names}, restent telles quelles.`,
    synced: (n: number) => `${count(n, "copie de serveur ajoutée", "copies de serveurs ajoutées")}.`,
    editIn: (agent: string) => `Modifier dans ${agent}…`,
    editMenu: "Modifier…",
    removeFrom: (agent: string) => `Retirer de ${agent}`,
    turnOff: "Désactiver",
    turnOn: "Activer",
    turnOffIn: (agent: string) => `Désactiver dans ${agent}`,
    turnOnIn: (agent: string) => `Activer dans ${agent}`,
    turnedOffIn: (name: string, agent: string) => `${name} désactivé dans ${agent}.`,
    turnedOnIn: (name: string, agent: string) => `${name} activé dans ${agent}.`,
    offCell: "Désactivé",
    offTip: "Désactivé : l’agent garde le serveur mais ne le démarre pas",
    different: "Différent",
    installed: "Installé",
    unsupported: "Non pris en charge",
    noSse: "Codex ne prend pas en charge les serveurs SSE",
    addCell: "Ajouter",
    copyTip: (name: string, from: string, to: string) => `Copier ${name} de ${from} vers ${to}`,
    inAgents: (agents: string) => `Dans ${agents}`,
    testLocal: (command: string) => `Lance ${command} sur cet ordinateur, liste ses outils, puis l’arrête`,
    testRemote: "Se connecte au serveur et liste ses outils",
    test: "Tester",
    testing: "Test…",
    edit: "Modifier",
    openFile: "Ouvrir le fichier",
    remove: "Retirer",
    notIn: (agents: string) => `Absent de ${agents}`,
    addTo: (agent: string) => `Ajouter à ${agent}`,
    addToAll: "Ajouter à tous",
    copiesSettings: (agent: string) => `Copie les réglages de ${agent}, secrets compris.`,
    removeEverywhere: "Retirer de tous les agents",
    onlyOne: (agent: string, name: string) => `Seul ${agent} a ${name}.`,
    allSame: (name: string) => `Tous les agents lancent ${name} de la même façon.`,
    useEverywhere: (agent: string) => `Utiliser celui de ${agent} partout`,
    useHere: (agent: string) => `Utiliser celui de ${agent} ici`,
    secretsCopied: "AgentDeck copie les secrets sans les afficher. Chaque modification peut être annulée.",
    noBackups:
      "Aucune version antérieure pour l’instant. AgentDeck garde une sauvegarde de chaque fichier de config qu’il modifie, dans ~/.agentdeck/backups.",
    until: (date: string) => `Jusqu’au ${date}`,
    isNow: "C’est l’état actuel",
    restore: "Restaurer",
    restoreHint: "La restauration ne modifie que ce serveur. Les secrets restent masqués, et elle peut être annulée.",
    sameAsNow: "Identique à maintenant.",
    notSetUp: "Non configuré.",
    ran: (command: string) => `Lançait ${command}.`,
    otherSettings: "D’autres réglages que maintenant.",
    command: "Commande",
    httpUrl: "URL HTTP",
    sseUrl: "URL SSE",
    variables: "Variables",
    headers: "En-têtes",
    cwd: "Dossier de travail",
    timeout: "Délai",
    onlyTools: "Seulement ces outils",
    neverTools: "Jamais ces outils",
    state: "État",
    off: "Désactivé",
    added: (name: string, agents: string) => `${name} ajouté à ${agents}.`,
    removed: (name: string, agents: string) => `${name} retiré de ${agents}.`,
    saved: (name: string, agents: string) => `${name} enregistré dans ${agents}.`,
    nowUse: (agents: string, name: string, from: string) =>
      `${agents} utilise${agents.includes(" et ") ? "nt" : ""} maintenant les réglages de ${name} de ${from}.`,
    notCarried: (settings: string) => `Non repris : ${settings}.`,
    putBack: (name: string, agent: string) => `${name} remis dans ${agent} tel qu’il était.`,
    removedAsItWas: (name: string, agent: string) => `${name} retiré de ${agent}, comme avant.`,
  },
  servers: {
    here: "ici",
    inAgent: (agent: string) => `dans ${agent}`,
    then: "alors",
    now: "maintenant",
    runs: (mine: string, here: string, theirs: string, there: string) =>
      `Lance ${mine} ${here}, ${theirs} ${there}.`,
    setOnly: (key: string, where: string, notWhere: string) => `${key} est défini ${where}, pas ${notWhere}.`,
    otherValue: (key: string, there: string) => `${key} a une autre valeur que ${there}.`,
    option: (label: string, mine: string, here: string, theirs: string, there: string) =>
      `${label} : ${mine} ${here}, ${theirs} ${there}.`,
    wasInKeychain: "Ses secrets étaient alors dans le trousseau.",
    wasInFile: "Ses secrets étaient alors dans le fichier de config.",
    cwd: "Dossier de travail",
    timeout: "Délai",
    allowedTools: "Outils autorisés",
    blockedTools: "Outils bloqués",
    notSet: "non défini",
    default: "par défaut",
    none: "aucun",
    all: "tous",
  },
  skills: {
    title: "Skills",
    description:
      "Des dossiers avec un SKILL.md que les agents chargent à la demande. Codex, Gemini CLI et Cursor partagent ~/.agents/skills, et Cursor lit aussi les dossiers de Claude Code et de Codex : une seule copie peut servir à plusieurs agents.",
    search: "Rechercher des skills",
    searchLabel: "Rechercher des skills par nom ou description",
    searchHint: "La recherche porte sur les noms et les descriptions.",
    noMatch: (query: string) => `Aucun skill ne correspond à « ${query} »`,
    trash: "Corbeille",
    trashHint: "Les skills retirés ou remplacés depuis AgentDeck, dans ~/.agentdeck/trash",
    trashEmpty: "La corbeille est vide.",
    fromRemoved: (folder: string, date: string) => `De ${folder} · retiré le ${date}`,
    restore: "Restaurer",
    newSkill: "Nouveau skill",
    emptyTitle: "Aucun skill installé",
    empty: "Les skills que vous ajoutez au dossier de skills d’un agent apparaissent ici.",
    skill: "Skill",
    shared: "partagé",
    copiesDiffer: "Copies différentes",
    loadedFrom: (path: string) => `Chargé depuis ${path}`,
    copyTip: (path: string) => `Copie ${path}, la copie modifiée en dernier`,
    copied: (name: string, agent: string) => `« ${name} » copié pour ${agent}.`,
    showCopy: "Afficher cette copie",
    copyFacts: (readers: string | null, edited: string) =>
      `Chargé par ${readers ?? "aucun agent"} · modifié le ${edited}`,
    newest: "la plus récente",
    differsFrom: (n: number) => `diffère ${n <= 1 ? "de l’autre copie" : `de ${n} copies`}`,
    useEverywhere: "Utiliser partout",
    howToShow: "Affichage de SKILL.md",
    preview: "Aperçu",
    source: "Source",
    files: "Fichiers",
    showInFolder: "Afficher dans le dossier",
    readingFolder: "Lecture du dossier…",
    first500: "Seuls les 500 premiers fichiers sont listés.",
    bytes: "o",
    kb: "Ko",
    mb: "Mo",
    noBackups: (name: string) =>
      `Aucune copie retirée ou remplacée de ${name}. AgentDeck les déplace dans ~/.agentdeck/trash.`,
    removedOn: (date: string) => `Retiré le ${date}`,
    spreadTitle: (name: string) => `Utiliser cette copie de ${name} partout ?`,
    replaceCopies: (n: number) => `Remplacer ${count(n, "copie", "copies")}`,
    replaced: (n: number, name: string) =>
      n <= 1
        ? `${n} copie de ${name} remplacée. L’ancienne est dans la corbeille.`
        : `${n} copies de ${name} remplacées. Les anciennes sont dans la corbeille.`,
    spreadBody: (from: ReactNode, replaced: ReactNode): ReactNode => (
      <>
        La copie de {from} remplace celle de {replaced}. Les dossiers remplacés vont dans la corbeille, d’où vous pouvez
        les restaurer.
      </>
    ),
    restoreTitle: (name: string) => `Remplacer le ${name} actuel ?`,
    restoreReplace: "Restaurer et remplacer",
    restoreBody: (folder: ReactNode, name: string, date: string): ReactNode => (
      <>
        {folder} a déjà un skill nommé {name}. Il va dans la corbeille et celui retiré le {date} prend sa place.
      </>
    ),
    removeTitle: (name: string) => `Retirer ${name} ?`,
    moveToTrash: "Mettre à la corbeille",
    movedToTrash: (name: string) => `${name} mis à la corbeille.`,
    removeBody: (readers: string | null, path: ReactNode): ReactNode => (
      <>
        {readers ? `${readers} ne le chargera plus depuis ` : "Retire "}
        {path}. Le dossier va dans la corbeille, d’où vous pouvez le restaurer.
      </>
    ),
    created: (name: string, folder: string) => `${name} créé dans ${folder}. Remplissez son SKILL.md.`,
    restored: (name: string, folder: string) => `${name} restauré dans ${folder}.`,
    name: "Nom",
    nameTaken: (folder: string, name: string) => `${folder} a déjà un skill nommé ${name}.`,
    nameRule: "Lettres minuscules, chiffres et tirets simples. C’est le nom du dossier.",
    folder: "Dossier",
    loadedBy: (agents: string) => `Chargé par ${agents}`,
    descriptionField: "Description",
    descriptionHint: "Ce que fait le skill, et quand l’agent doit l’utiliser",
    create: "Créer",
    allSame: (name: string) => `Toutes les copies de ${name} sont identiques.`,
    copyToCompare: "Copie à comparer",
    diffHint: (from: ReactNode, to: ReactNode): ReactNode => (
      <>
        Ce qui change dans SKILL.md entre {from} et la copie la plus récente, dans {to}.
      </>
    ),
    readingCopies: "Lecture des copies…",
    sameSkillMd: "SKILL.md est identique : ce sont d’autres fichiers des dossiers qui diffèrent.",
  },
  rules: {
    title: "Règles",
    description:
      "Les instructions globales que chaque agent charge à chaque session. Écrivez-les une fois, puis copiez-les vers les autres agents. Cursor garde ses règles utilisateur dans ses propres réglages : AgentDeck ne peut pas encore les modifier.",
    what: (agent: string) => `règles de ${agent}`,
    agents: "Agents",
    saved: (agent: string) => `Règles de ${agent} enregistrées.`,
    lines: (n: number) => count(n, "ligne", "lignes"),
    changedOnDisk: (agent: string) =>
      `Les règles de ${agent} ont changé sur le disque pendant que vous les modifiiez. Enregistrer remplace cette version.`,
    reload: "Abandonner mes modifications et recharger",
    makeBase: "Créer une base commune",
    makeBaseTip:
      "Marque ces règles comme la base commune à tous les agents. Les lignes que vous placez ensuite sous le marqueur de fin restent propres à cet agent.",
    hidePreview: "Masquer l’aperçu",
    placeholder: "Pas encore de règles. Écrivez du Markdown ici.",
    nothingToPreview: "Rien à prévisualiser pour l’instant.",
    revert: "Rétablir",
    copyTo: "Copier vers",
    copyBaseTo: "Copier la base commune vers",
    sameBase: "Même base commune",
    identical: "Déjà identiques",
    saveFirst: "Enregistrez d’abord",
    putBase: (agent: string) => `Mettre cette base commune dans les règles de ${agent}`,
    replaceWithThese: (agent: string) => `Remplacer les règles de ${agent} par celles-ci`,
    sharedHint: (start: ReactNode, end: ReactNode): ReactNode => (
      <>
        Le texte entre {start} et {end} est la base commune. La copier vers un autre agent garde le reste de ses règles.
      </>
    ),
    copyBaseTitle: (to: string) => `Copier la base commune vers ${to} ?`,
    replaceEverything: "Tout remplacer",
    copyBase: "Copier la base commune",
    copied: (from: string, to: string) => `Règles de ${from} copiées vers ${to}.`,
    copiedBase: (from: string, to: string) => `Base commune de ${from} copiée vers ${to}.`,
    baseReplaced: (to: string, from: string) =>
      `La base commune de ${to} est remplacée par celle de ${from}, et le reste de ses règles ne change pas.`,
    baseAdded: (to: string, from: string) =>
      `Les règles de ${to} reçoivent la base commune de ${from} en tête, et gardent ce qu’elles ont en dessous.`,
    orReplaceAll: (to: string, lines: string, from: string) =>
      `Choisissez Tout remplacer pour donner à ${to} exactement les ${lines} des règles de ${from}.`,
    replaceTitle: (to: string) => `Remplacer les règles de ${to} ?`,
    replace: (to: string) => `Remplacer les règles de ${to}`,
    replacedWith: (theirLines: string, to: string, lines: string, from: string) =>
      `Les ${theirLines} des règles de ${to} sont remplacées par les ${lines} de celles de ${from}.`,
    getsRules: (to: string, lines: string, from: string) =>
      `${to} n’a pas encore de règles. Il reçoit les ${lines} de celles de ${from}.`,
    noBase: "Pas de base",
    noBaseTip: (agent: string) => `Pas encore de base commune : copiez celle de ${agent} pour l’ajouter`,
    sameBaseBadge: "Même base",
    sameBaseTip: (agent: string) => `Même base commune que ${agent}`,
    baseDiffers: "Base différente",
    baseDiffersTip: (agent: string) => `La base commune diffère de celle de ${agent}`,
    noRules: "Pas de règles",
    same: "Identiques",
    sameTip: (agent: string) => `Identiques aux règles enregistrées de ${agent}`,
    differs: "Différentes",
    differsTip: (agent: string) => `Différentes des règles enregistrées de ${agent}`,
  },
  importing: {
    notObject: "Collez un objet JSON, comme {\"mcpServers\": {…}}.",
    noServer: "Aucun serveur trouvé : chacun a besoin d’une commande ou d’une URL.",
    notJson: "Ce n’est pas du JSON valide.",
  },
  catalog: {
    github: {
      summary: "Dépôts, issues et pull requests",
      note: "Nécessite un jeton d’accès personnel GitHub, envoyé sous la forme Bearer <jeton>.",
    },
    context7: { summary: "La documentation à jour des bibliothèques" },
    playwright: { summary: "Pilote un navigateur pour tester et parcourir des pages" },
    linear: {
      summary: "Issues, projets et cycles",
      note: "Chaque agent vous demande de vous connecter à Linear la première fois qu’il l’utilise.",
    },
    sentry: {
      summary: "Erreurs et problèmes de performance",
      note: "Chaque agent vous demande de vous connecter à Sentry la première fois qu’il l’utilise.",
    },
    notion: {
      summary: "Les pages et bases de données d’un espace de travail",
      note: "Chaque agent vous demande de vous connecter à Notion la première fois qu’il l’utilise.",
    },
    filesystem: {
      summary: "Lit et écrit des fichiers dans les dossiers que vous listez",
      note: "Remplacez l’argument vide par un dossier que le serveur peut utiliser, et ajoutez un argument par dossier supplémentaire.",
    },
    memory: { summary: "Un graphe de connaissances conservé entre les sessions" },
    fetch: { summary: "Récupère des pages web en Markdown", note: "Fonctionne avec uv, d’astral.sh." },
    "sequential-thinking": { summary: "Un raisonnement étape par étape pour les problèmes difficiles" },
  },
  serverForm: {
    editTitle: (name: string, agent: string) => `Modifier ${name} dans ${agent}`,
    startFrom: "Partir d’un serveur courant",
    docs: "Documentation",
    pasteJson: "Ou collez ses réglages JSON",
    fillIn: "Remplir le formulaire",
    pasteHint: "Depuis un README, ou la config de Claude Code, Cursor ou Gemini CLI.",
    pastedServers: "Serveurs du JSON collé",
    jsonHas: (n: number) => `Le JSON contient ${n} serveurs :`,
    transport: "Transport",
    local: "Commande locale",
    sse: "SSE (ancien)",
    addTo: "Ajouter à",
    createsConfig: "crée sa config",
    alreadyHas: (name: string) => `A déjà ${name}`,
    pasteCommand: "Coller une ligne de commande entière remplit aussi les arguments.",
    arguments: "Arguments",
    argument: (n: number) => `Argument ${n}`,
    argumentPlaceholder: "Argument",
    removeArgument: (n: number) => `Retirer l’argument ${n}`,
    addArgument: "Ajouter un argument",
    envVariables: "Variables d’environnement",
    valueOf: (key: string) => `Valeur de ${key || "cette variable"}`,
    unchanged: "Inchangée, masquée",
    value: "Valeur",
    hideValue: "Masquer la valeur",
    showValue: "Afficher la valeur",
    removeVariable: (key: string) => `Retirer ${key || "cette variable"}`,
    addHeader: "Ajouter un en-tête",
    addVariable: "Ajouter une variable",
    neverShown: "Les valeurs ne sont jamais affichées. Tapez dans un champ pour remplacer sa valeur.",
    advanced: "Réglages avancés",
    onlyUse: (agents: string) => `Seuls ${agents} les utilisent.`,
    defaultValue: "Par défaut",
    timeout: "Délai des outils (secondes)",
    allTools: "Tous, ou outil_a, outil_b",
    turnedOff: "Désactivé : les agents gardent le serveur mais ne le démarrent pas",
    alsoApply: "Appliquer aussi à",
    replacedSettings: (name: string) => `Leurs réglages de ${name} sont remplacés par ceux-ci, secrets compris.`,
    addToAgents: (n: number) => `Ajouter à ${n} agents`,
    chooseAgent: "Choisissez au moins un agent.",
    giveCommand: "Indiquez la commande qui démarre le serveur.",
    emptyArgument: "Remplissez ou retirez l’argument vide.",
    nameEachHeader: "Donnez un nom à chaque en-tête.",
    nameEachVariable: "Donnez un nom à chaque variable.",
    setTwice: (key: string) => `${key} est défini deux fois.`,
    giveValue: (keys: string) => `Donnez une valeur à ${keys}.`,
    timeoutNumber: "Le délai est un nombre de secondes.",
  },
  nav: {
    main: "Principal",
    tagline: "Centre de contrôle",
    configure: "Configurer",
    insights: "Suivi",
    overview: "Vue d’ensemble",
    mcp: "Serveurs MCP",
    rules: "Règles",
    skills: "Skills",
    secrets: "Secrets",
    history: "Historique et coûts",
    search: "Recherche et commandes",
    reload: "Recharger les configs",
    noConfig: (path: string) => `Installé, pas encore de ${path}`,
    notFound: "Introuvable sur cet ordinateur",
    switchTheme: {
      system: "Suivre le thème du système",
      light: "Passer au thème clair",
      dark: "Passer au thème sombre",
    },
    editRules: (agent: string) => `Modifier les règles de ${agent}`,
    copyTo: (name: string, agent: string) => `Copier ${name} vers ${agent}`,
    server: "Serveur MCP",
    skill: "Skill",
    keywords: {
      page: "aller à la page go to page",
      add: "ajouter nouveau add new",
      settings: "paramètres préférences thème langue mises à jour sauvegardes corbeille dossiers settings",
      reload: "recharger actualiser refresh reload",
      theme: "thème sombre clair theme dark light",
      edit: "modifier réglages edit",
    },
  },
  overview: {
    description: "Tous les agents de code IA de cet ordinateur, et ce qui demande votre attention.",
    more: (n: number) => `${n} autre${n <= 1 ? "" : "s"}`,
    launcherMissing: (servers: string) => `Le lanceur agentdeck qu’ils utilisent est introuvable : ${servers}.`,
    plainTitle: (n: number) =>
      n <= 1 ? `${n} clé d’API est stockée en clair` : `${n} clés d’API sont stockées en clair`,
    plainDetail: (n: number, servers: string) =>
      `Tout programme qui peut lire les configs peut ${n <= 1 ? "la" : "les"} lire : ${servers}.`,
    moveToKeychain: "Mettre dans le trousseau",
    differTitle: (n: number) =>
      n <= 1 ? `${n} serveur diffère entre les agents` : `${n} serveurs diffèrent entre les agents`,
    differDetail: (servers: string) => `Une autre commande, variable ou option : ${servers}.`,
    review: "Voir",
    partialTitle: (n: number) =>
      n <= 1 ? `${n} serveur n’est pas sur tous les agents` : `${n} serveurs ne sont pas sur tous les agents`,
    copy: "Copier",
    rulesTitle: "Les règles diffèrent entre les agents",
    rulesDetail: (agents: string) => `${agents} chargent chacun leurs propres instructions.`,
    compare: "Comparer",
    allGood: "Tout est en ordre",
    allGoodDetail: (n: number) =>
      `${n <= 1 ? `${n} serveur est identique` : `${n} serveurs sont identiques`} sur tous les agents et aucun secret n’est stocké en clair.`,
    weekCost: "Coût estimé, 7 derniers jours",
    noSession: "Aucune session cette semaine",
    fromLogs: "D’après les journaux de Claude Code et Codex",
    detected: "Détecté",
    noConfig: "Pas encore de config",
    notFound: "Introuvable",
    inAppSettings: "Dans les réglages de l’app",
    openConfig: "Ouvrir la config",
  },
  secrets: {
    description: (
      <>
        Les clés d’API et jetons des configs de serveurs MCP. En clair, tout ce qui peut lire ces fichiers peut les lire.
        AgentDeck les déplace dans le trousseau du système : un serveur local démarre alors par{" "}
        <code>agentdeck exec</code>, qui les lui transmet, et les en-têtes d’un serveur distant lisent une variable que
        votre shell définit. Les valeurs ne sont jamais affichées ici.
      </>
    ),
    keychains: {
      mac: { name: "Trousseau macOS", the: "le trousseau macOS" },
      windows: { name: "Gestionnaire d’identification Windows", the: "le Gestionnaire d’identification Windows" },
      linux: { name: "Secret Service", the: "Secret Service" },
    },
    protectAll: "Tout protéger",
    noLauncher: (
      <>
        Déplacer des secrets dans le trousseau nécessite l’outil en ligne de commande <code>agentdeck</code> fourni avec
        AgentDeck, et il est introuvable à côté de l’app. Réinstallez AgentDeck, ou installez l’outil avec{" "}
        <code>cargo install --path crates/agentdeck-cli</code>.
      </>
    ),
    inPlainText: "En clair",
    canProtect: (n: number) =>
      `${count(n, "serveur", "serveurs")} ${n <= 1 ? "peut être protégé" : "peuvent être protégés"}`,
    nothingLeft: "Plus rien à protéger",
    protected: "Protégés",
    andVariables: (keychain: string) => `${keychain} et variables`,
    ready: "Prêt",
    missing: "Absent",
    toRepair: (n: number) => `${count(n, "serveur protégé", "serveurs protégés")} à réparer`,
    launcherNotFound: "agentdeck est introuvable",
    shellHook: (variables: string, n: number, windows: boolean, keychain: string): ReactNode => (
      <>
        Les serveurs distants lisent {variables} depuis votre shell. Cette ligne dans le profil de votre shell (
        {windows ? (
          <code>$PROFILE</code>
        ) : (
          <>
            <code>~/.zshrc</code>, <code>~/.bashrc</code> ou équivalent
          </>
        )}
        ) {n <= 1 ? "la" : "les"} définit depuis {keychain} à chaque démarrage d’un shell. Les agents lancés ensuite{" "}
        {n <= 1 ? "la" : "les"} trouvent.
      </>
    ),
    copy: "Copier",
    copiedLine: "Ligne copiée.",
    copyFailed: (err: string) => `Impossible de copier : ${err}`,
    emptyTitle: "Aucun serveur MCP n’utilise de secrets",
    empty: "Les serveurs avec des clés d’API ou des jetons dans leur config apparaissent ici.",
    secret: "Secret",
    stored: "Stockage",
    wontStart: "Ne démarre pas",
    wontStartTip: "Le lanceur agentdeck par lequel ce serveur démarre est introuvable",
    runs: (agent: string) => `Ce que lance ${agent}`,
    envVariable: "Variable d’environnement",
    httpHeader: "En-tête HTTP",
    envVariableLower: "variable d’environnement",
    httpHeaderLower: "en-tête HTTP",
    keychain: "Trousseau",
    readsVariable: "La config lit cette variable au lieu de contenir la valeur",
    plainText: "En clair",
    sameValue: (n: number) => `Même valeur à ${count(n, "autre endroit", "autres endroits")}`,
    moving: "Déplacement…",
    putBack: (server: string) => `Secrets de ${server} remis dans sa config.`,
    restoreToConfig: "Remettre dans la config",
    otherVariables: "Autres variables",
    othersHint: (n: number, example: ReactNode): ReactNode => (
      <>
        {count(n, "réglage", "réglages")} comme {example}, {n <= 1 ? "gardé" : "gardés"} dans la config
      </>
    ),
    protectTitle: (server: string) => `Mettre les secrets de ${server} dans le trousseau ?`,
    moved: (server: string) => `Secrets de ${server} mis dans le trousseau.`,
    moves: (moved: string[], kept: string[], keychain: string) =>
      `${list(moved)} ${moved.length <= 1 ? "va" : "vont"} dans ${keychain}${
        kept.length > 0 ? `, et ${list(kept)} ${kept.length <= 1 ? "reste" : "restent"} dans la config` : ""
      }.`,
    readsHeaders: (agent: string, n: number, variables: string) =>
      `${agent} ${n <= 1 ? "le" : "les"} lit alors depuis ${variables}, que votre shell définit depuis le trousseau avec la ligne ci-dessous dans son profil. C’est annulable.`,
    startsThroughExec: (agent: string, server: string): ReactNode => (
      <>
        {agent} démarre alors {server} par <code>agentdeck exec</code>, qui les lui relit. C’est annulable.
      </>
    ),
    now: "Maintenant",
    after: "Après",
    protectAllTitle: (n: number) => `Mettre les secrets de ${count(n, "serveur", "serveurs")} dans le trousseau ?`,
    movedAll: (n: number) => `Secrets de ${count(n, "serveur", "serveurs")} mis dans le trousseau.`,
    beforeAfter: (before: number, after: number, protectedAfter: number, keychain: string): ReactNode => (
      <>
        Avant : {count(before, "secret", "secrets")} en clair. Après : {after} en clair, {protectedAfter} dans{" "}
        {keychain}. Les serveurs locaux démarrent alors par <code>agentdeck exec</code>, qui les leur relit, et les
        serveurs distants lisent leurs en-têtes depuis des variables que votre shell définit. C’est annulable.
      </>
    ),
    markedAs: (secret: boolean) => `Marqué comme ${secret ? "secret" : "réglage"} par vous`,
    reset: "Réinitialiser",
    notSecret: "Pas un secret",
    treatAsSecret: "Traiter comme un secret",
    judgedAgain: (name: string) => `${name} est de nouveau jugé d’après son nom et sa valeur.`,
    nowTreated: (name: string, secret: boolean) =>
      `${name} est maintenant traité comme ${secret ? "un secret" : "un réglage"} sur tous les serveurs.`,
  },
  errors: {
    noHomeDir: () => "Impossible de trouver le dossier personnel",
    io: (e) => `Impossible d’accéder à ${e.path} : ${e.detail}`,
    json: (e) => `JSON invalide dans ${e.path} : ${e.detail}`,
    toml: (e) => `TOML invalide dans ${e.path} : ${e.detail}`,
    conflict: (e) =>
      `${e.path} n’a cessé de changer pendant qu’AgentDeck l’écrivait. Fermez l’agent qui l’utilise et réessayez`,
    invalidServer: (e) => `Serveur MCP « ${e.name} » invalide dans ${e.path} : ${e.detail}`,
    missingValue: (e) => `${e.name} n’a pas de valeur : saisissez-en une, ou retirez-la`,
    invalid: (e) => `Structure inattendue dans ${e.path} : ${e.detail}`,
    notFound: (e) => `${e.agent} n’a pas de serveur MCP nommé « ${e.name} »`,
    alreadyExists: (e) => `${e.agent} a déjà un serveur MCP nommé « ${e.name} »`,
    noRulesFile: (e) => `${e.agent} garde ses règles globales dans ses propres réglages, pas dans un fichier`,
    keychain: (e) => `Trousseau du système : ${e.detail}`,
    noSharedRules: (e) =>
      `Les règles de ${e.agent} n’ont pas de base commune : placez-la entre ${SHARED_START} et ${SHARED_END}`,
    invalidSkillName: (e) => `« ${e.name} » n’est pas un nom de skill valide`,
    newSkillName: (e) =>
      `« ${e.name} » ne peut pas nommer un nouveau skill : utilisez des lettres minuscules, des chiffres et des tirets simples, 64 caractères au plus`,
    skillNotFound: (e) => `Aucun skill dans ${e.path}`,
    skillExists: (e) => `Un skill existe déjà dans ${e.path}`,
    unsupported: (e) =>
      e.detail === "SSE MCP servers" ? `${e.agent} ne prend pas en charge les serveurs MCP SSE` : e.message,
    undoExpired: () => "Cette modification ne peut plus être annulée.",
    rulesChanged: (e) => `Les règles de ${e.agent} ont changé depuis : elles sont restées telles quelles.`,
    launcherMissing: () =>
      "La commande agentdeck par laquelle démarrent les serveurs protégés est introuvable. Réinstallez AgentDeck.",
    notCreated: (e) => `${e.path} n’existe pas encore.`,
  } satisfies Record<ErrorCode, (error: ErrorInfo) => string>,
  history: {
    description:
      "D’après les journaux de session de Claude Code et Codex sur cet ordinateur. Les coûts sont estimés aux prix publics de l’API : un abonnement Claude ou ChatGPT est facturé autrement. Cursor et Gemini CLI ne gardent pas de journaux d’utilisation en local.",
    million: " M",
    thousand: " k",
    noProject: "Sans projet",
    unknownModel: "Modèle inconnu",
    unknown: "Inconnu",
    exported: (n: number, file: string) => `${count(n, "session exportée", "sessions exportées")} dans ${file}.`,
    exportTip: (n: number) =>
      `Enregistrer ${n <= 1 ? "la session affichée" : `les ${count(n, "session", "sessions")} affichées`} ci-dessous en CSV`,
    nothingToExport: "Aucune session à exporter",
    exportCsv: "Exporter en CSV",
    reload: "Recharger les journaux",
    period: "Période",
    days: (n: number) => `${n} jours`,
    custom: "Personnalisée",
    from: "Du",
    to: "au",
    until: "Au",
    agent: "Agent",
    allAgents: "Tous les agents",
    reading: "Lecture des journaux de session",
    readingFiles: (done: string, total: string) => `Lecture des journaux de session : ${done} fichiers sur ${total}`,
    logsRead: "Journaux de session lus",
    estimatedCost: "Coût estimé",
    sessionsInDays: (sessions: number, days: number) =>
      `${count(sessions, "session", "sessions")} en ${count(days, "jour", "jours")}`,
    agentStats: (tokens: string, sessions: number) => `${tokens} tokens · ${count(sessions, "session", "sessions")}`,
    thisMonth: "Ce mois-ci",
    of: (budget: string) => `sur ${budget}`,
    budgetUsed: "Budget mensuel utilisé",
    budgetLabel: "Budget mensuel en dollars",
    budgetPlaceholder: "Budget en $",
    changeBudget: "Modifier le budget",
    setBudget: "Définir un budget mensuel",
    overBudget: (cost: string, budget: string) =>
      `Le coût estimé de ce mois, ${cost}, dépasse votre budget de ${budget}.`,
    nearBudget: (share: string, budget: string) =>
      `Le coût estimé de ce mois atteint ${share} de votre budget de ${budget}.`,
    costPerDay: "Coût par jour",
    groupBy: "Grouper par",
    views: { sessions: "Sessions", projects: "Projets", models: "Modèles" },
    searchPlaceholder: "Rechercher titres, projets, modèles",
    search: "Rechercher des sessions",
    noSession: "Aucune session sur cette période",
    noMatch: "Aucune session ne correspond",
    project: "Projet",
    models: "Modèles",
    model: "Modèle",
    lastUsed: "Dernière utilisation",
    tokens: "Tokens",
    cost: "Coût",
    date: "Date",
    session: "Session",
    untitled: "Session sans titre",
    unpriced: (tokens: string) => `${tokens} tokens de modèles sans prix connu ne sont pas comptés`,
    showing: (shown: number, total: number) => `${shown} sur ${count(total, "session", "sessions")}`,
    showMore: (n: number) => `Afficher ${n} de plus`,
    tokenKinds: {
      input: "Entrée",
      cacheRead: "Lecture du cache",
      cacheWrite5m: "Écriture du cache (5 min)",
      cacheWrite1h: "Écriture du cache (1 h)",
      output: "Sortie",
    },
    minutes: (n: number) => `${n} min`,
    hours: (hours: number, minutes: number) => `${hours} h ${minutes} min`,
    daysLong: (n: number) => `${n} jours`,
    copiedCommand: "Commande copiée.",
    started: "Début",
    ended: "Fin",
    cacheHit: (share: string) => `Taux de cache : ${share} de l’entrée a été lue depuis le cache.`,
    listPrices: "Aux prix publics de l’API.",
    resume: "Reprendre",
    runIn: (folder: string) => `Lancez-la dans ${folder} pour reprendre cette session.`,
    sessionsOf: (project: string) => `Afficher les sessions de ${project}`,
  },
};
