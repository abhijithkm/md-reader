; Extra Windows integration for MD Reader.
;
; electron-builder already registers the .md and .markdown file types (the
; ProgIDs MDReader.md and MDReader.markdown, with an "Open with" command) from
; `fileAssociations` in electron-builder.yml. This file adds what lets people
; pick MD Reader under Settings > Apps > Default apps, and removes it all again.
;
; Windows stores an explicit choice of program per file type (UserChoice) where an
; installer cannot change it, so whoever already picked a program for .md keeps it,
; and only the user can change it in Settings. Where nobody has chosen, the per-user
; registration made here makes MD Reader the program that opens the type.

!macro customInstall
  ; The "Open with" list: the application and the file types it can open.
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}" "FriendlyAppName" "${PRODUCT_NAME}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\shell\open\command" "" '"$appExe" "%1"'
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".md" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".markdown" ""

  ; electron-builder writes the command that opens .md and .markdown files with the program path
  ; unquoted, which is ambiguous when the user's profile folder has a space in its name. This macro
  ; runs after it does, so write the commands again, quoted.
  WriteRegStr SHELL_CONTEXT "Software\Classes\MDReader.md\shell\open\command" "" '"$appExe" "%1"'
  WriteRegStr SHELL_CONTEXT "Software\Classes\MDReader.markdown\shell\open\command" "" '"$appExe" "%1"'

  ; electron-builder keeps a copy of the installer (about 100 MB) in %LOCALAPPDATA%\md-reader-updater.
  ; The updater compares the next version with it, so that an update downloads only what changed
  ; instead of the whole installer. It also keeps the last installer it downloaded in a "pending"
  ; folder there until the next update replaces it, so the folder can hold about 200 MB. All of it
  ; stays while the program is installed, and the uninstaller removes it.

  ; Settings > Apps > Default apps: capabilities registered for this user. They live under the
  ; publisher's name, and the entry in RegisteredApplications is named after it too, so that
  ; uninstalling can never remove the entries of another program that is also called MDReader.
  WriteRegStr SHELL_CONTEXT "Software\AbhijithKM\MDReader\Capabilities" "ApplicationName" "${PRODUCT_NAME}"
  WriteRegStr SHELL_CONTEXT "Software\AbhijithKM\MDReader\Capabilities" "ApplicationDescription" "Read Markdown files offline."
  WriteRegStr SHELL_CONTEXT "Software\AbhijithKM\MDReader\Capabilities\FileAssociations" ".md" "MDReader.md"
  WriteRegStr SHELL_CONTEXT "Software\AbhijithKM\MDReader\Capabilities\FileAssociations" ".markdown" "MDReader.markdown"
  WriteRegStr SHELL_CONTEXT "Software\RegisteredApplications" "AbhijithKM.MDReader" "Software\AbhijithKM\MDReader\Capabilities"

  !insertmacro UPDATEFILEASSOC
!macroend

!macro customUnInstall
  ; electron-builder sets the default value of the .md and .markdown keys to our
  ; ProgIDs and removes the ProgIDs, but leaves that default pointing at nothing.
  ; Clear it, only if it is still ours. During an upgrade the new version
  ; registers everything again straight away, so leave it alone.
  Push $0
  ${ifNot} ${isUpdated}
    ReadRegStr $0 SHELL_CONTEXT "Software\Classes\.md" ""
    ${If} $0 == "MDReader.md"
      DeleteRegValue SHELL_CONTEXT "Software\Classes\.md" ""
    ${EndIf}
    ReadRegStr $0 SHELL_CONTEXT "Software\Classes\.markdown" ""
    ${If} $0 == "MDReader.markdown"
      DeleteRegValue SHELL_CONTEXT "Software\Classes\.markdown" ""
    ${EndIf}
  ${endIf}
  Pop $0

  ; The updater's folder: the copy of the installer it keeps for small downloads, and any update
  ; that was downloaded but not installed. An upgrade runs this macro too, from inside an installer
  ; that is itself started from that folder, so only a real uninstall removes it.
  ${ifNot} ${isUpdated}
    RMDir /r "$LOCALAPPDATA\md-reader-updater"
  ${endIf}

  DeleteRegValue SHELL_CONTEXT "Software\RegisteredApplications" "AbhijithKM.MDReader"
  DeleteRegKey SHELL_CONTEXT "Software\AbhijithKM\MDReader"
  ; The publisher's key itself, only if nothing else has been put in it.
  DeleteRegKey /ifempty SHELL_CONTEXT "Software\AbhijithKM"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}"
!macroend
