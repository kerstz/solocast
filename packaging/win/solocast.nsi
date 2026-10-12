; Installeur SoloCast : par utilisateur (aucun droit administrateur), sans page de choix de dossier.
; Appelé par scripts/package.mjs avec :
;   -DVERSION=0.1.0[-rc1] -DVERSION4=0.1.0.0 -DSRC=<dossier> -DOUTFILE=<.exe> -DICON=<.ico> [-DSIZE_KB=n]
; Installation silencieuse : SoloCast-Setup-x.y.z.exe /S
; Désinstallation silencieuse : "<dossier>\Uninstall.exe" /S _?=<dossier>
Unicode true
ManifestDPIAware true
ManifestSupportedOS Win10
RequestExecutionLevel user
SetCompressor /SOLID lzma

!ifndef VERSION
  !error "-DVERSION manquant (voir scripts/package.mjs)"
!endif
!ifndef VERSION4
  !error "-DVERSION4 manquant (x.y.z.0, exigé par VIProductVersion)"
!endif
!ifndef SRC
  !error "-DSRC manquant"
!endif
!ifndef OUTFILE
  !error "-DOUTFILE manquant"
!endif
!ifndef ICON
  !error "-DICON manquant"
!endif

!define APP "SoloCast"
!define PUBLISHER "kerstz"
!define URL "https://github.com/kerstz/solocast"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\SoloCast"
!define FIREWALL_RULE "SoloCast video"

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "x64.nsh"
!include "WinVer.nsh"
!insertmacro GetSize

Name "${APP}"
Caption "Installation de ${APP} ${VERSION}"
BrandingText "${APP} ${VERSION}"
OutFile "${OUTFILE}"
; Nouvelle installation : dossier standard des applications par utilisateur.
; Mise à jour (y compris depuis 0.1.0, dans %LOCALAPPDATA%\SoloCast) : on reprend l'ancien dossier.
InstallDir "$LOCALAPPDATA\Programs\SoloCast"
InstallDirRegKey HKCU "${UNINST_KEY}" "InstallLocation"
ShowInstDetails nevershow
ShowUninstDetails nevershow

VIProductVersion "${VERSION4}"
VIFileVersion "${VERSION4}"

!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_ABORTWARNING
!define MUI_COMPONENTSPAGE_NODESC

!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\SoloCast.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Lancer SoloCast"
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_COMPONENTS
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "French"

VIAddVersionKey /LANG=${LANG_FRENCH} "ProductName" "${APP}"
VIAddVersionKey /LANG=${LANG_FRENCH} "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=${LANG_FRENCH} "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=${LANG_FRENCH} "FileDescription" "Installation de ${APP}"
VIAddVersionKey /LANG=${LANG_FRENCH} "CompanyName" "${PUBLISHER}"
VIAddVersionKey /LANG=${LANG_FRENCH} "LegalCopyright" "${PUBLISHER}"
VIAddVersionKey /LANG=${LANG_FRENCH} "OriginalFilename" "SoloCast-Setup-${VERSION}.exe"

; Arrête SoloCast : uniquement les exécutables situés sous $INSTDIR (jamais un autre node.exe).
; PowerShell 64 bits (Sysnative : cet installeur est un programme 32 bits) et CIM, dont
; ExecutablePath reste lisible entre architectures. Le dossier passe par l'environnement : une
; apostrophe ou un accent dans le chemin ne casse rien. On attend la fin des processus.
!macro STOP_SOLOCAST
  System::Call 'kernel32::SetEnvironmentVariable(t "SOLOCAST_DIR", t "$INSTDIR")i'
  nsExec::ExecToLog `"$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$d = $$env:SOLOCAST_DIR.TrimEnd([char]92) + [char]92; $$p = @(Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -and $$_.ExecutablePath.StartsWith($$d, [StringComparison]::OrdinalIgnoreCase) }); foreach ($$x in $$p) { Stop-Process -Id $$x.ProcessId -Force -ErrorAction SilentlyContinue }; foreach ($$x in $$p) { Wait-Process -Id $$x.ProcessId -Timeout 10 -ErrorAction SilentlyContinue }"`
  Pop $0
!macroend

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "SoloCast nécessite Windows 10 ou 11 en 64 bits." /SD IDOK
    Abort
  ${EndIf}
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_ICONSTOP "SoloCast nécessite Windows 10 ou 11 en 64 bits." /SD IDOK
    Abort
  ${EndIf}
  SetShellVarContext current
FunctionEnd

Function un.onInit
  SetShellVarContext current
FunctionEnd

Section "SoloCast (requis)" SecMain
  SectionIn RO
  !insertmacro STOP_SOLOCAST
  SetOutPath "$INSTDIR"
  ; Mise à jour : les fichiers du site ont des noms hachés ; on repart de dossiers propres.
  RMDir /r "$INSTDIR\web"
  RMDir /r "$INSTDIR\licenses"
  Delete "$INSTDIR\solocast.vbs" ; lanceur de la 0.1.0
  SetOverwrite on
  File /r "${SRC}\*.*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  CreateDirectory "$SMPROGRAMS\SoloCast"
  CreateShortcut "$SMPROGRAMS\SoloCast\SoloCast.lnk" "$INSTDIR\SoloCast.exe" "" "$INSTDIR\SoloCast.exe" 0 SW_SHOWNORMAL "" "Diffuser un direct et le partager avec un lien"
  CreateShortcut "$SMPROGRAMS\SoloCast\Désinstaller SoloCast.lnk" "$INSTDIR\Uninstall.exe"

  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${APP}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\SoloCast.exe"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "${PUBLISHER}"
  WriteRegStr HKCU "${UNINST_KEY}" "URLInfoAbout" "${URL}"
  WriteRegStr HKCU "${UNINST_KEY}" "HelpLink" "${URL}/issues"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  WriteRegDWORD HKCU "${UNINST_KEY}" "EstimatedSize" "$0"
SectionEnd

Section "Raccourci sur le Bureau" SecDesktop
  SetOutPath "$INSTDIR"
  CreateShortcut "$DESKTOP\SoloCast.lnk" "$INSTDIR\SoloCast.exe" "" "$INSTDIR\SoloCast.exe" 0 SW_SHOWNORMAL "" "Diffuser un direct et le partager avec un lien"
SectionEnd

; Décochée par défaut (donc ignorée en installation silencieuse) : demande les droits
; administrateur une seule fois. Sans règle, Windows peut bloquer la vidéo vers les spectateurs
; hors du réseau local (réseau « public »).
Section /o "Autoriser la vidéo pour les spectateurs distants (pare-feu Windows)" SecFirewall
  ExecShellWait "runas" "$SYSDIR\cmd.exe" '/c netsh advfirewall firewall delete rule name="${FIREWALL_RULE}" & netsh advfirewall firewall add rule name="${FIREWALL_RULE}" dir=in action=allow program="$INSTDIR\livekit-server.exe" enable=yes profile=any' SW_HIDE
  WriteRegDWORD HKCU "${UNINST_KEY}" "SoloCastFirewallRule" 1
SectionEnd

Section "-un.SoloCast"
  ; Garde-fou : ne jamais vider un dossier qui n'est pas une installation SoloCast.
  ${IfNot} ${FileExists} "$INSTDIR\solocast.mjs"
    MessageBox MB_ICONSTOP "$INSTDIR ne contient pas SoloCast : désinstallation annulée." /SD IDOK
    Abort
  ${EndIf}
  !insertmacro STOP_SOLOCAST
  Delete "$DESKTOP\SoloCast.lnk"
  RMDir /r "$SMPROGRAMS\SoloCast"
  RMDir /r "$INSTDIR\web"
  RMDir /r "$INSTDIR\licenses"
  Delete "$INSTDIR\SoloCast.exe"
  Delete "$INSTDIR\node.exe"
  Delete "$INSTDIR\livekit-server.exe"
  Delete "$INSTDIR\cloudflared.exe"
  Delete "$INSTDIR\solocast.mjs"
  Delete "$INSTDIR\solocast.vbs"
  Delete "$INSTDIR\solocast.ico"
  Delete "$INSTDIR\THIRD_PARTY.txt"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  ReadRegDWORD $1 HKCU "${UNINST_KEY}" "SoloCastFirewallRule"
  ${If} $1 = 1
    ExecShellWait "runas" "$SYSDIR\cmd.exe" '/c netsh advfirewall firewall delete rule name="${FIREWALL_RULE}"' SW_HIDE
  ${EndIf}
  DeleteRegKey HKCU "${UNINST_KEY}"
SectionEnd

; Décochée par défaut : conservée par une désinstallation silencieuse (mise à jour, test).
Section /o "un.Supprimer aussi mes réglages (%APPDATA%\SoloCast)" SecUnData
  RMDir /r "$APPDATA\SoloCast"
  RMDir /r "$LOCALAPPDATA\SoloCast-state"
SectionEnd
