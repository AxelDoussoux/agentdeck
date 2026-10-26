import type { ReactNode } from "react";
import type { ErrorCode, ErrorInfo } from "../lib/types";

/** `1 skill`, `2 skills`: the count and the noun that agrees with it. */
const count = (n: number, one: string, many: string) => `${n.toLocaleString("en")} ${n === 1 ? one : many}`;

/** "A", "A and B", "A, B and C". */
const list = (items: string[]) => new Intl.ListFormat("en-GB", { type: "conjunction" }).format(items);

/**
 * The English texts of the app, the reference for every other language: a
 * translation has the same keys, and functions with the same parameters.
 */
export const en = {
  common: {
    cancel: "Cancel",
    close: "Close",
    open: "Open",
    none: "None",
    actions: "Actions",
    actionsFor: (name: string) => `Actions for ${name}`,
    clearSearch: "Clear the search",
    save: "Save",
    discard: "Discard",
    unsaved: "Unsaved changes",
    notSaved: (what: string) => `Your changes to the ${what} are not saved.`,
    notFound: (agent: string) => `${agent} was not found on this computer`,
    /** A text about something, such as an agent's error: "Cursor: …". */
    about: (what: string, text: string) => `${what}: ${text}`,
  },
  toast: {
    region: "Notifications",
    undo: "Undo",
    undoing: "Undoing…",
    undone: "Undone.",
    undoFailed: (err: string) => `Could not undo: ${err}`,
    dismiss: "Dismiss",
  },
  drawer: {
    sections: "Sections",
  },
  palette: {
    label: "Command palette",
    placeholder: "Go to a page, find a server or a skill, run a command",
    commands: "Commands",
    nothing: (query: string) => `Nothing matches “${query}”.`,
    more: (n: number) => `${n} more: type more words to narrow down.`,
  },
  test: {
    starting: "Starting the server… The first run can take a while if it has to be downloaded.",
    works: (server: string, time: string) => `Works${server ? `: ${server}` : ""}, answered in ${time}.`,
    noTools: "It has no tools, only prompts or resources.",
    tools: (n: number) => `${count(n, "tool", "tools")}.`,
    output: "Server output",
  },
  launcher: {
    title: (n: number) => (n === 1 ? "1 protected server no longer starts" : `${n} protected servers no longer start`),
    gone: (path: ReactNode, others: number): ReactNode => (
      <>
        Their agent runs the <code>agentdeck</code> launcher from {path}
        {others > 0 && ` and ${count(others, "other place", "other places")}`}, which is gone: AgentDeck was likely
        moved or reinstalled.
      </>
    ),
    repairHint: "Repair points them at this copy; their secrets stay in the keychain.",
    reinstall: "Reinstall AgentDeck, then repair them here.",
    repair: "Repair",
    repairing: "Repairing…",
    repaired: (n: number) => `Repaired ${count(n, "protected server", "protected servers")}. Restart the agents that use them.`,
  },
  update: {
    available: (version: string, current: string) => `AgentDeck ${version} is available (you have ${current}).`,
    install: "Install and restart",
    later: "Later",
    downloading: "Downloading…",
    restarting: "Restarting…",
    failed: (err: string) => `Update failed: ${err}`,
  },
  diff: {
    label: "Differences",
    unchanged: (n: number) => count(n, "unchanged line", "unchanged lines"),
  },
  chart: {
    label: "Estimated cost per day. Use the arrow keys to read each day.",
    noUsage: "No usage",
  },
  markdown: {
    empty: "Empty",
    image: "Image",
  },
  editor: {
    /** CodeMirror's own texts, such as its search panel; English is built in. */
    phrases: {} as Record<string, string>,
  },
  settings: {
    title: "Settings",
    description: "How AgentDeck looks, where it finds each agent, and the files it keeps.",
    appearance: "Appearance",
    theme: "Theme",
    themes: { system: "Match the system", light: "Light", dark: "Dark" },
    language: "Language",
    systemLanguage: "Match the system",
    updates: "Updates",
    checkedAtStart: "Checked when the app starts.",
    checking: "Checking…",
    latest: "This is the latest version.",
    versionAvailable: (version: string) => `Version ${version} is available.`,
    checkFailed: (err: string) => `Could not check for updates: ${err}`,
    releaseNotes: "Release notes",
    checkNow: "Check now",
    folders: "Agent folders",
    foldersHint: (
      <>
        Where AgentDeck reads and writes each agent's files. Claude Code and Codex use another folder when{" "}
        <code>CLAUDE_CONFIG_DIR</code> or <code>CODEX_HOME</code> is set, and AgentDeck follows them. Choose the folder
        here when the app does not see them, as when it is opened from the macOS Finder.
      </>
    ) as ReactNode,
    setBy: (variable: string) => `Set by ${variable}.`,
    chosen: "Chosen in AgentDeck.",
    change: "Change…",
    useDefault: "Reset",
    folderChosen: (agent: string) => `AgentDeck now reads ${agent}'s files from the folder you chose.`,
    folderReset: (agent: string) => `AgentDeck reads ${agent}'s files from its default folder again.`,
    protected: "Protected servers",
    launcher: "Launcher",
    launcherMissing: "Not found: reinstall AgentDeck.",
    launcherHint: (
      <>
        Servers whose keys are in the keychain start through this <code>agentdeck</code> command.
      </>
    ) as ReactNode,
    backups: "Backups",
    backupsHint: (n: number, kept: number) =>
      `${count(n, "backup", "backups")}. Each write keeps the previous version; the last ${kept} of each file are kept.`,
    trash: "Skills trash",
    trashEmpty: "Empty.",
    trashHint: (n: number) =>
      `${count(n, "skill", "skills")} removed or replaced, which you can restore from the Skills page.`,
    emptyTrash: "Empty trash",
    emptyTitle: "Empty the skills trash?",
    deleteForGood: "Delete for good",
    emptyBody: (n: number) =>
      `${n === 1 ? "1 skill is" : `${n} skills are`} deleted for good. This cannot be undone.`,
    trashEmptied: (n: number) => `Deleted ${count(n, "skill", "skills")} for good.`,
  },
  mcp: {
    title: "MCP servers",
    description:
      "Each row is a server, each column an agent. Add a server to another agent in one click: its settings and secrets are copied for you.",
    search: "Search servers",
    searchLabel: "Search servers by name, command or URL",
    searchHint: "Search looks at names, commands and URLs.",
    noMatch: (query: string) => `No server matches “${query}”`,
    add: "Add server",
    addTitle: "Add an MCP server",
    addSubtitle: "To one agent or several at once.",
    server: "Server",
    emptyTitle: "No MCP server configured yet",
    empty: "Add one with the button above, or install one in any agent: it shows up here.",
    details: "Details",
    differences: "Differences",
    backups: "Backups",
    addEverywhere: "Add to every agent",
    unsynced: (n: number) => `Not in sync (${n})`,
    unsyncedTip: "Show only the servers missing from an installed agent, or set up differently",
    allInSync: "Every server is in sync",
    allInSyncHint: "Each installed agent has every server, set up the same way.",
    showAll: "Show all servers",
    sync: "Sync everywhere",
    syncTip: "Add each server to the installed agents that do not have it",
    syncTitle: "Add the missing servers to every installed agent?",
    syncConfirm: (n: number) => `Add ${count(n, "copy", "copies")}`,
    syncLine: (name: ReactNode, from: string, to: string): ReactNode => (
      <>
        {name} from {from}, to {to}
      </>
    ),
    syncHint: "Settings and secrets are copied without being shown. One Undo reverts them all.",
    syncDiffering: (names: string) => `Copies that differ, such as ${names}, are left as they are.`,
    synced: (n: number) => `Added ${count(n, "copy", "copies")} of servers.`,
    editIn: (agent: string) => `Edit in ${agent}…`,
    editMenu: "Edit…",
    removeFrom: (agent: string) => `Remove from ${agent}`,
    delete: "Delete",
    turnOff: "Turn off",
    turnOn: "Turn on",
    turnOffIn: (agent: string) => `Turn off in ${agent}`,
    turnOnIn: (agent: string) => `Turn on in ${agent}`,
    turnedOffIn: (name: string, agent: string) => `Turned ${name} off in ${agent}.`,
    turnedOnIn: (name: string, agent: string) => `Turned ${name} on in ${agent}.`,
    offCell: "Off",
    profiles: "Profiles",
    profileButton: (name: string) => `Profile: ${name}`,
    profileTip: "Switch between sets of servers: a profile turns its servers on and every other one off, on every agent",
    manageProfiles: "Manage profiles…",
    newProfile: "New profile",
    profileTitle: "Profiles",
    profilePick: "Profile",
    profileName: "Name",
    profileNameHint: "Work, Personal, a client…",
    profileServers: "Servers it turns on",
    profileHint: "Every other server is turned off, on every agent. Servers keep their settings.",
    profileSaved: (name: string) => `Saved the ${name} profile.`,
    profileDeleted: (name: string) => `Deleted the ${name} profile. Servers stay as they are.`,
    profileUsed: (name: string, n: number) =>
      n === 0 ? `The servers already match ${name}.` : `Using ${name}: ${count(n, "server", "servers")} turned on or off.`,
    offTip: "Turned off: the agent keeps the server but does not start it",
    different: "Different",
    installed: "Installed",
    unsupported: "Not supported",
    noSse: "Codex does not support SSE servers",
    addCell: "Add",
    copyTip: (name: string, from: string, to: string) => `Copy ${name} from ${from} to ${to}`,
    inAgents: (agents: string) => `In ${agents}`,
    testLocal: (command: string) => `Runs ${command} on this computer, lists its tools, then stops it`,
    testRemote: "Connects to the server and lists its tools",
    test: "Test",
    testing: "Testing…",
    edit: "Edit",
    openFile: "Open file",
    remove: "Remove",
    notIn: (agents: string) => `Not in ${agents}`,
    addTo: (agent: string) => `Add to ${agent}`,
    addToAll: "Add to all",
    copiesSettings: (agent: string) => `Copies the settings of ${agent}, secrets included.`,
    removeEverywhere: "Remove from every agent",
    onlyOne: (agent: string, name: string) => `Only ${agent} has ${name}.`,
    allSame: (name: string) => `Every agent runs ${name} the same way.`,
    useEverywhere: (agent: string) => `Use ${agent}'s everywhere`,
    useHere: (agent: string) => `Use ${agent}'s here`,
    secretsCopied: "Secrets are copied by AgentDeck without being shown. Each change can be undone.",
    noBackups:
      "No earlier version yet. AgentDeck keeps a backup of each config file it changes, in ~/.agentdeck/backups.",
    until: (date: string) => `Until ${date}`,
    isNow: "This is how it is now",
    restore: "Restore",
    restoreHint: "Restoring changes only this server. Secrets stay hidden, and it can be undone.",
    sameAsNow: "Same as now.",
    notSetUp: "Not set up.",
    ran: (command: string) => `Ran ${command}.`,
    otherSettings: "Other settings than now.",
    command: "Command",
    httpUrl: "HTTP URL",
    sseUrl: "SSE URL",
    variables: "Variables",
    headers: "Headers",
    cwd: "Working directory",
    timeout: "Timeout",
    onlyTools: "Only these tools",
    neverTools: "Never these tools",
    state: "State",
    off: "Turned off",
    added: (name: string, agents: string) => `Added ${name} to ${agents}.`,
    removed: (name: string, agents: string) => `Removed ${name} from ${agents}.`,
    saved: (name: string, agents: string) => `Saved ${name} in ${agents}.`,
    nowUse: (agents: string, name: string, from: string) => `${agents} now use the ${name} settings of ${from}.`,
    notCarried: (settings: string) => `Not carried over: ${settings}.`,
    putBack: (name: string, agent: string) => `Put back ${name} in ${agent} as it was.`,
    removedAsItWas: (name: string, agent: string) => `Removed ${name} from ${agent}, as it was.`,
  },
  /** How copies of a server differ. `here` and `there` are the words below. */
  servers: {
    here: "here",
    inAgent: (agent: string) => `in ${agent}`,
    then: "then",
    now: "now",
    runs: (mine: string, here: string, theirs: string, there: string) => `Runs ${mine} ${here}, ${theirs} ${there}.`,
    setOnly: (key: string, where: string, notWhere: string) => `${key} is set ${where}, not ${notWhere}.`,
    otherValue: (key: string, there: string) => `${key} has another value than ${there}.`,
    option: (label: string, mine: string, here: string, theirs: string, there: string) =>
      `${label}: ${mine} ${here}, ${theirs} ${there}.`,
    wasInKeychain: "Its secrets were in the keychain then.",
    wasInFile: "Its secrets were in the config file then.",
    cwd: "Working directory",
    timeout: "Timeout",
    allowedTools: "Allowed tools",
    blockedTools: "Blocked tools",
    notSet: "not set",
    default: "default",
    none: "none",
    all: "all",
  },
  skills: {
    title: "Skills",
    description:
      "Folders with a SKILL.md that agents load on demand. Codex, Gemini CLI and Cursor share ~/.agents/skills, and Cursor also reads the Claude Code and Codex folders, so one copy can reach several agents.",
    search: "Search skills",
    searchLabel: "Search skills by name or description",
    searchHint: "Search looks at names and descriptions.",
    noMatch: (query: string) => `No skill matches “${query}”`,
    trash: "Trash",
    trashHint: "Skills removed or replaced from AgentDeck, in ~/.agentdeck/trash",
    trashEmpty: "The trash is empty.",
    fromRemoved: (folder: string, date: string) => `From ${folder} · removed ${date}`,
    restore: "Restore",
    newSkill: "New skill",
    emptyTitle: "No skill installed yet",
    empty: "Skills you add to any agent's skills folder show up here.",
    skill: "Skill",
    shared: "shared",
    copiesDiffer: "Copies differ",
    loadedFrom: (path: string) => `Loaded from ${path}`,
    copyTip: (path: string) => `Copies ${path}, the copy edited last`,
    copied: (name: string, agent: string) => `Copied "${name}" for ${agent}.`,
    showCopy: "Show this copy",
    copyFacts: (readers: string | null, edited: string) => `Loaded by ${readers ?? "no agent"} · edited ${edited}`,
    newest: "newest",
    differsFrom: (n: number) => `differs from ${n === 1 ? "the other copy" : `${n} copies`}`,
    useEverywhere: "Use everywhere",
    howToShow: "How to show SKILL.md",
    preview: "Preview",
    source: "Source",
    files: "Files",
    showInFolder: "Show in folder",
    readingFolder: "Reading the folder…",
    first500: "Only the first 500 files are listed.",
    bytes: "B",
    kb: "KB",
    mb: "MB",
    noBackups: (name: string) => `No removed or replaced copy of ${name}. AgentDeck moves them to ~/.agentdeck/trash.`,
    removedOn: (date: string) => `Removed ${date}`,
    spreadTitle: (name: string) => `Use this copy of ${name} everywhere?`,
    replaceCopies: (n: number) => `Replace ${count(n, "copy", "copies")}`,
    replaced: (n: number, name: string) =>
      n === 1
        ? `Replaced 1 copy of ${name}. The old one is in the trash.`
        : `Replaced ${n} copies of ${name}. The old ones are in the trash.`,
    spreadBody: (from: ReactNode, replaced: ReactNode): ReactNode => (
      <>
        The copy in {from} replaces the one in {replaced}. The replaced folders move to the trash, where you can restore
        them.
      </>
    ),
    restoreTitle: (name: string) => `Replace the current ${name}?`,
    restoreReplace: "Restore and replace",
    restoreBody: (folder: ReactNode, name: string, date: string): ReactNode => (
      <>
        {folder} already has a skill named {name}. It moves to the trash and the one removed on {date} takes its place.
      </>
    ),
    removeTitle: (name: string) => `Remove ${name}?`,
    moveToTrash: "Move to trash",
    movedToTrash: (name: string) => `Moved ${name} to the trash.`,
    removeBody: (readers: string | null, path: ReactNode): ReactNode => (
      <>
        {readers ? `${readers} will no longer load it from ` : "Removes "}
        {path}. The folder moves to the trash, where you can restore it.
      </>
    ),
    created: (name: string, folder: string) => `Created ${name} in ${folder}. Fill in its SKILL.md.`,
    restored: (name: string, folder: string) => `Restored ${name} to ${folder}.`,
    name: "Name",
    nameTaken: (folder: string, name: string) => `${folder} already has a skill named ${name}.`,
    nameRule: "Lowercase letters, digits and single hyphens. It names the folder.",
    folder: "Folder",
    loadedBy: (agents: string) => `Loaded by ${agents}`,
    descriptionField: "Description",
    descriptionHint: "What the skill does, and when the agent should use it",
    create: "Create",
    allSame: (name: string) => `Every copy of ${name} is the same.`,
    copyToCompare: "Copy to compare",
    diffHint: (from: ReactNode, to: ReactNode): ReactNode => (
      <>
        What changes in SKILL.md from {from} to the newest copy, in {to}.
      </>
    ),
    readingCopies: "Reading the copies…",
    sameSkillMd: "SKILL.md is the same: other files in the folders differ.",
  },
  rules: {
    title: "Rules",
    description:
      "Global instructions each agent loads into every session. Write them once, then copy them to the other agents. Cursor keeps its user rules in its own settings, so AgentDeck cannot edit them yet.",
    /** Names an agent's rules in sentences, such as unsaved changes. */
    what: (agent: string) => `${agent} rules`,
    agents: "Agents",
    saved: (agent: string) => `Saved ${agent} rules.`,
    lines: (n: number) => count(n, "line", "lines"),
    changedOnDisk: (agent: string) =>
      `${agent}'s rules changed on disk while you were editing. Saving replaces that version.`,
    reload: "Discard my edits and reload",
    makeBase: "Make a shared base",
    makeBaseTip:
      "Marks these rules as the base shared by every agent. Lines you then move below the end marker stay specific to this agent.",
    hidePreview: "Hide preview",
    placeholder: "No rules yet. Write Markdown here.",
    nothingToPreview: "Nothing to preview yet.",
    revert: "Revert",
    copyTo: "Copy to",
    copyBaseTo: "Copy the shared base to",
    sameBase: "Same shared base",
    identical: "Already identical",
    saveFirst: "Save first",
    putBase: (agent: string) => `Put this shared base in ${agent}'s rules`,
    replaceWithThese: (agent: string) => `Replace ${agent} rules with these`,
    sharedHint: (start: ReactNode, end: ReactNode): ReactNode => (
      <>
        The text between {start} and {end} is the shared base. Copying it to another agent keeps the rest of that
        agent's rules.
      </>
    ),
    copyBaseTitle: (to: string) => `Copy the shared base to ${to}?`,
    replaceEverything: "Replace everything",
    copyBase: "Copy the shared base",
    copied: (from: string, to: string) => `Copied ${from} rules to ${to}.`,
    copiedBase: (from: string, to: string) => `Copied the shared base of ${from} to ${to}.`,
    baseReplaced: (to: string, from: string) =>
      `${to}'s shared base is replaced with ${from}'s, and the rest of its rules stay as they are.`,
    baseAdded: (to: string, from: string) =>
      `${to}'s rules get ${from}'s shared base on top, and keep what they have below it.`,
    orReplaceAll: (to: string, lines: string, from: string) =>
      `Replace everything instead to give ${to} exactly the ${lines} of ${from}'s rules.`,
    replaceTitle: (to: string) => `Replace ${to} rules?`,
    replace: (to: string) => `Replace ${to} rules`,
    replacedWith: (theirLines: string, to: string, lines: string, from: string) =>
      `The ${theirLines} of ${to}'s rules are replaced with the ${lines} of ${from}'s.`,
    getsRules: (to: string, lines: string, from: string) => `${to} has no rules yet. It gets the ${lines} of ${from}'s.`,
    noBase: "No base",
    noBaseTip: (agent: string) => `No shared base yet: copy ${agent}'s to add it`,
    sameBaseBadge: "Same base",
    sameBaseTip: (agent: string) => `Same shared base as ${agent}`,
    baseDiffers: "Base differs",
    baseDiffersTip: (agent: string) => `Shared base differs from ${agent}'s`,
    noRules: "No rules yet",
    same: "Same",
    sameTip: (agent: string) => `Same as the saved ${agent} rules`,
    differs: "Differs",
    differsTip: (agent: string) => `Differs from the saved ${agent} rules`,
  },
  importing: {
    notObject: 'Paste a JSON object, such as {"mcpServers": {…}}.',
    noServer: "No server found: each one needs a command or a URL.",
    notJson: "This is not valid JSON.",
  },
  /** The servers the add form can start from, by name. */
  catalog: {
    github: {
      summary: "Repositories, issues and pull requests",
      note: "Needs a GitHub personal access token, sent as Bearer <token>.",
    },
    context7: { summary: "Up-to-date documentation of libraries" },
    playwright: { summary: "Drives a browser to test and browse pages" },
    linear: {
      summary: "Issues, projects and cycles",
      note: "Each agent asks you to sign in to Linear the first time it uses it.",
    },
    sentry: {
      summary: "Errors and performance issues",
      note: "Each agent asks you to sign in to Sentry the first time it uses it.",
    },
    notion: {
      summary: "Pages and databases of a workspace",
      note: "Each agent asks you to sign in to Notion the first time it uses it.",
    },
    filesystem: {
      summary: "Reads and writes files in the folders you list",
      note: "Replace the empty argument with a folder the server may use, and add one argument per extra folder.",
    },
    memory: { summary: "A knowledge graph kept between sessions" },
    fetch: { summary: "Fetches web pages as Markdown", note: "Runs with uv, from astral.sh." },
    "sequential-thinking": { summary: "Step-by-step reasoning for hard problems" },
  } as Record<
    | "github"
    | "context7"
    | "playwright"
    | "linear"
    | "sentry"
    | "notion"
    | "filesystem"
    | "memory"
    | "fetch"
    | "sequential-thinking",
    { summary: string; note?: string }
  >,
  serverForm: {
    editTitle: (name: string, agent: string) => `Edit ${name} in ${agent}`,
    startFrom: "Start from a common server",
    docs: "Documentation",
    pasteJson: "Or paste its JSON settings",
    fillIn: "Fill in the form",
    pasteHint: "From a README, or the config of Claude Code, Cursor or Gemini CLI.",
    pastedServers: "Servers in the pasted JSON",
    jsonHas: (n: number) => `The JSON has ${n} servers:`,
    transport: "Transport",
    local: "Local command",
    sse: "SSE (legacy)",
    addTo: "Add to",
    createsConfig: "creates its config",
    alreadyHas: (name: string) => `Already has ${name}`,
    pasteCommand: "Pasting a whole command line fills in the arguments too.",
    arguments: "Arguments",
    argument: (n: number) => `Argument ${n}`,
    argumentPlaceholder: "Argument",
    removeArgument: (n: number) => `Remove argument ${n}`,
    addArgument: "Add an argument",
    envVariables: "Environment variables",
    valueOf: (key: string) => `Value of ${key || "this variable"}`,
    unchanged: "Unchanged, hidden",
    value: "Value",
    hideValue: "Hide the value",
    showValue: "Show the value",
    removeVariable: (key: string) => `Remove ${key || "this variable"}`,
    addHeader: "Add a header",
    addVariable: "Add a variable",
    neverShown: "Values are never shown. Type in a field to replace that value.",
    advanced: "Advanced settings",
    onlyUse: (agents: string) => `Only ${agents} use these.`,
    defaultValue: "Default",
    timeout: "Tool timeout (seconds)",
    allTools: "All, or tool_a, tool_b",
    turnedOff: "Turned off: the agents keep the server but do not start it",
    alsoApply: "Also apply to",
    replacedSettings: (name: string) => `Their settings for ${name} are replaced with these, secrets included.`,
    addToAgents: (n: number) => `Add to ${n} agents`,
    chooseAgent: "Choose at least one agent.",
    giveCommand: "Give the command that starts the server.",
    emptyArgument: "Fill in or remove the empty argument.",
    nameEachHeader: "Give each header a name.",
    nameEachVariable: "Give each variable a name.",
    setTwice: (key: string) => `${key} is set twice.`,
    giveValue: (keys: string) => `Give ${keys} a value.`,
    timeoutNumber: "The timeout is a number of seconds.",
  },
  nav: {
    main: "Main",
    tagline: "Control center",
    configure: "Configure",
    insights: "Insights",
    overview: "Overview",
    mcp: "MCP servers",
    rules: "Rules",
    skills: "Skills",
    secrets: "Secrets",
    history: "History & costs",
    search: "Search and commands",
    reload: "Reload configs",
    noConfig: (path: string) => `Installed, no ${path} yet`,
    notFound: "Not found on this computer",
    switchTheme: { system: "Match the system theme", light: "Switch to the light theme", dark: "Switch to the dark theme" },
    editRules: (agent: string) => `Edit ${agent} rules`,
    copyTo: (name: string, agent: string) => `Copy ${name} to ${agent}`,
    server: "MCP server",
    skill: "Skill",
    /** Extra words the palette matches commands on. */
    keywords: {
      page: "go to page",
      add: "add new",
      settings: "preferences theme language updates backups trash folders",
      reload: "refresh",
      theme: "theme dark light",
      edit: "change settings",
    },
  },
  overview: {
    description: "Every AI coding agent on this computer, and what needs your attention.",
    more: (n: number) => `${n} more`,
    launcherMissing: (servers: string) => `The agentdeck launcher they run is missing: ${servers}.`,
    unreadableTitle: (agent: string) => `The config of ${agent} cannot be read`,
    plainTitle: (n: number) => `${n === 1 ? "1 API key is" : `${n} API keys are`} stored in plain text`,
    plainDetail: (n: number, servers: string) =>
      `Any program that can read the configs can read ${n === 1 ? "it" : "them"}: ${servers}.`,
    moveToKeychain: "Move to keychain",
    differTitle: (n: number) => `${n === 1 ? "1 server differs" : `${n} servers differ`} between agents`,
    differDetail: (servers: string) => `Another command, variable or setting: ${servers}.`,
    review: "Review",
    partialTitle: (n: number) => `${n === 1 ? "1 server is" : `${n} servers are`} not on every agent`,
    copy: "Copy",
    rulesTitle: "Rules differ between agents",
    rulesDetail: (agents: string) => `${agents} each load their own instructions.`,
    compare: "Compare",
    allGood: "Everything is in order",
    allGoodDetail: (n: number) =>
      `${n === 1 ? "1 server is" : `${n} servers are`} the same on every agent and no secret sits in plain text.`,
    weekCost: "Estimated cost, last 7 days",
    noSession: "No session logged this week",
    fromLogs: "From Claude Code and Codex logs",
    detected: "Detected",
    noConfig: "No config yet",
    notFound: "Not found",
    inAppSettings: "In app settings",
    openConfig: "Open config",
  },
  secrets: {
    description: (
      <>
        API keys and tokens set in MCP server configs. In plain text, anything that can read these files can read them.
        AgentDeck moves them to your system keychain: a local server then starts through <code>agentdeck exec</code>,
        which passes them back, and a remote server's headers read a variable that your shell sets. Values are never
        shown here.
      </>
    ) as ReactNode,
    keychains: {
      mac: { name: "macOS Keychain", the: "the macOS Keychain" },
      windows: { name: "Windows Credential Manager", the: "the Windows Credential Manager" },
      linux: { name: "Secret Service", the: "the Secret Service" },
    },
    protectAll: "Protect all",
    noLauncher: (
      <>
        Moving secrets to the keychain needs the <code>agentdeck</code> command-line tool that ships with AgentDeck, and
        it was not found next to the app. Reinstall AgentDeck, or install the tool with{" "}
        <code>cargo install --path crates/agentdeck-cli</code>.
      </>
    ) as ReactNode,
    inPlainText: "In plain text",
    canProtect: (n: number) => `${count(n, "server", "servers")} can be protected`,
    nothingLeft: "Nothing left to protect",
    protected: "Protected",
    andVariables: (keychain: string) => `${keychain} and variables`,
    ready: "Ready",
    missing: "Missing",
    toRepair: (n: number) => `${count(n, "protected server", "protected servers")} to repair`,
    launcherNotFound: "agentdeck was not found",
    shellHook: (variables: string, n: number, windows: boolean, keychain: string): ReactNode => (
      <>
        Remote servers read {variables} from your shell. This line in your shell profile (
        {windows ? (
          <code>$PROFILE</code>
        ) : (
          <>
            <code>~/.zshrc</code>, <code>~/.bashrc</code> or similar
          </>
        )}
        ) sets {n === 1 ? "it" : "them"} from {keychain} each time a shell starts. Agents started afterwards find{" "}
        {n === 1 ? "it" : "them"}.
      </>
    ),
    copy: "Copy",
    copiedLine: "Copied the line.",
    copyFailed: (err: string) => `Could not copy: ${err}`,
    emptyTitle: "No MCP server uses secrets",
    empty: "Servers with API keys or tokens in their config show up here.",
    secret: "Secret",
    stored: "Stored",
    wontStart: "Won't start",
    wontStartTip: "The agentdeck launcher this server starts through is missing",
    runs: (agent: string) => `What ${agent} runs`,
    envVariable: "Environment variable",
    httpHeader: "HTTP header",
    envVariableLower: "environment variable",
    httpHeaderLower: "HTTP header",
    keychain: "Keychain",
    readsVariable: "The config reads this variable instead of holding the value",
    plainText: "Plain text",
    sameValue: (n: number) => `Same value in ${count(n, "other place", "other places")}`,
    moving: "Moving…",
    putBack: (server: string) => `Put the secrets of ${server} back in its config.`,
    restoreToConfig: "Restore to config",
    otherVariables: "Other variables",
    othersHint: (n: number, example: ReactNode): ReactNode => (
      <>
        {count(n, "setting", "settings")} such as {example}, kept in the config
      </>
    ),
    protectTitle: (server: string) => `Move the secrets of ${server} to the keychain?`,
    moved: (server: string) => `Moved the secrets of ${server} to the keychain.`,
    moves: (moved: string[], kept: string[], keychain: string) =>
      `${list(moved)} ${moved.length === 1 ? "moves" : "move"} to ${keychain}${
        kept.length > 0 ? `, and ${list(kept)} ${kept.length === 1 ? "stays" : "stay"} in the config` : ""
      }.`,
    readsHeaders: (agent: string, n: number, variables: string) =>
      `${agent} then reads ${n === 1 ? "it" : "them"} from ${variables}, which your shell sets from the keychain with the line below in your shell profile. It can be undone.`,
    startsThroughExec: (agent: string, server: string): ReactNode => (
      <>
        {agent} then starts {server} through <code>agentdeck exec</code>, which reads them back. It can be undone.
      </>
    ),
    now: "Now",
    after: "After",
    protectAllTitle: (n: number) => `Move the secrets of ${count(n, "server", "servers")} to the keychain?`,
    movedAll: (n: number) => `Moved the secrets of ${count(n, "server", "servers")} to the keychain.`,
    beforeAfter: (before: number, after: number, protectedAfter: number, keychain: string): ReactNode => (
      <>
        Before: {count(before, "secret", "secrets")} in plain text. After: {after} in plain text, {protectedAfter} in{" "}
        {keychain}. Local servers then start through <code>agentdeck exec</code>, which reads them back, and remote
        servers read their headers from variables that your shell sets. It can be undone.
      </>
    ),
    markedAs: (secret: boolean) => `Marked as ${secret ? "a secret" : "a setting"} by you`,
    reset: "Reset",
    notSecret: "Not a secret",
    treatAsSecret: "Treat as a secret",
    judgedAgain: (name: string) => `${name} is judged by its name and value again.`,
    nowTreated: (name: string, secret: boolean) =>
      `${name} is now treated as a ${secret ? "secret" : "setting"} on every server.`,
  },
  /** Errors of the core by code; English uses the core's own messages. */
  errors: {} as Partial<Record<ErrorCode, (error: ErrorInfo) => string>>,
  history: {
    description:
      "Read from Claude Code and Codex session logs on this computer. Costs are estimated at API list prices: a Claude or ChatGPT subscription is billed differently. Cursor and Gemini CLI keep no usage logs locally.",
    million: "M",
    thousand: "k",
    noProject: "No project",
    unknownModel: "Unknown model",
    unknown: "Unknown",
    exported: (n: number, file: string) => `Exported ${count(n, "session", "sessions")} to ${file}.`,
    exportTip: (n: number) => `Save the ${count(n, "session", "sessions")} shown below as CSV`,
    nothingToExport: "No session to export",
    exportCsv: "Export CSV",
    reload: "Reload logs",
    period: "Period",
    days: (n: number) => `${n} days`,
    custom: "Custom",
    from: "From",
    to: "to",
    until: "To",
    agent: "Agent",
    allAgents: "All agents",
    reading: "Reading session logs",
    readingFiles: (done: string, total: string) => `Reading session logs: ${done} of ${total} files`,
    logsRead: "Session logs read",
    estimatedCost: "Estimated cost",
    sessionsInDays: (sessions: number, days: number) =>
      `${count(sessions, "session", "sessions")} in ${count(days, "day", "days")}`,
    agentStats: (tokens: string, sessions: number) => `${tokens} tokens · ${count(sessions, "session", "sessions")}`,
    thisMonth: "This month",
    of: (budget: string) => `of ${budget}`,
    budgetUsed: "Monthly budget used",
    budgetLabel: "Monthly budget in dollars",
    budgetPlaceholder: "Budget in $",
    changeBudget: "Change budget",
    setBudget: "Set a monthly budget",
    overBudget: (cost: string, budget: string) => `This month's estimated cost, ${cost}, is over your ${budget} budget.`,
    nearBudget: (share: string, budget: string) =>
      `This month's estimated cost has reached ${share} of your ${budget} budget.`,
    costPerDay: "Cost per day",
    groupBy: "Group by",
    views: { sessions: "Sessions", projects: "Projects", models: "Models" },
    searchPlaceholder: "Search titles, projects, models",
    search: "Search sessions",
    noSession: "No session in this period",
    noMatch: "No session matches",
    project: "Project",
    models: "Models",
    model: "Model",
    lastUsed: "Last used",
    tokens: "Tokens",
    cost: "Cost",
    date: "Date",
    session: "Session",
    untitled: "Untitled session",
    unpriced: (tokens: string) => `${tokens} tokens from models without a known price are not counted`,
    showing: (shown: number, total: number) => `Showing ${shown} of ${count(total, "session", "sessions")}`,
    showMore: (n: number) => `Show ${n} more`,
    tokenKinds: {
      input: "Input",
      cacheRead: "Cache read",
      cacheWrite5m: "Cache write (5 min)",
      cacheWrite1h: "Cache write (1 h)",
      output: "Output",
    },
    minutes: (n: number) => `${n} min`,
    hours: (hours: number, minutes: number) => `${hours} h ${minutes} min`,
    daysLong: (n: number) => `${n} days`,
    copiedCommand: "Copied the command.",
    started: "Started",
    ended: "Ended",
    cacheHit: (share: string) => `Cache hit rate: ${share} of the input was read from the cache.`,
    listPrices: "At API list prices.",
    resume: "Resume",
    runIn: (folder: string) => `Run it in ${folder} to continue this session.`,
    sessionsOf: (project: string) => `Show the sessions of ${project}`,
  },
};

export type Messages = typeof en;
