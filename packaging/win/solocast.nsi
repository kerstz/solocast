; Installeur SoloCast : par utilisateur (aucun droit administrateur), dans %LOCALAPPDATA%.
; Appelé par scripts/package.mjs avec -DVERSION -DSRC -DOUTFILE.
Unicode true
!include "MUI2.nsh"

Name "SoloCast"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\SoloCast"
RequestExecutionLevel user
SetCompressor /SOLID lzma

!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "French"

Section "SoloCast"
  ; Arrête SoloCast s'il tourne, en ne visant que les programmes lancés depuis CE dossier
  ; (sinon node.exe verrouille les fichiers, et on ne touche pas aux autres node/cloudflared).
  nsExec::Exec "powershell -NoProfile -Command $\"Get-Process node,livekit-server,cloudflared -ErrorAction SilentlyContinue | Where-Object { $$_.Path -like '$INSTDIR\*' } | Stop-Process -Force$\""
  SetOutPath "$INSTDIR"
  File /r "${SRC}\*.*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  ; Aucune console : le raccourci passe par solocast.vbs (fenêtre cachée). Le partage et l'arrêt
  ; se font depuis le studio, dans le navigateur.
  CreateDirectory "$SMPROGRAMS\SoloCast"
  CreateShortcut "$SMPROGRAMS\SoloCast\SoloCast.lnk" "$WINDIR\System32\wscript.exe" '"$INSTDIR\solocast.vbs"' "$INSTDIR\solocast.ico" 0 SW_SHOWNORMAL "" "Diffuser un direct et le partager avec un lien"
  CreateShortcut "$SMPROGRAMS\SoloCast\Désinstaller SoloCast.lnk" "$INSTDIR\Uninstall.exe"
  CreateShortcut "$DESKTOP\SoloCast.lnk" "$WINDIR\System32\wscript.exe" '"$INSTDIR\solocast.vbs"' "$INSTDIR\solocast.ico" 0 SW_SHOWNORMAL "" "Diffuser un direct et le partager avec un lien"

  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SoloCast" "DisplayName" "SoloCast"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SoloCast" "DisplayIcon" "$INSTDIR\solocast.ico"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SoloCast" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SoloCast" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SoloCast" "InstallLocation" "$INSTDIR"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SoloCast" "NoModify" 1
SectionEnd

Section "Uninstall"
  ; Arrête SoloCast s'il tourne, en ne visant que les programmes lancés depuis CE dossier
  ; (sinon node.exe verrouille les fichiers, et on ne touche pas aux autres node/cloudflared).
  nsExec::Exec "powershell -NoProfile -Command $\"Get-Process node,livekit-server,cloudflared -ErrorAction SilentlyContinue | Where-Object { $$_.Path -like '$INSTDIR\*' } | Stop-Process -Force$\""
  Delete "$DESKTOP\SoloCast.lnk"
  RMDir /r "$SMPROGRAMS\SoloCast"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SoloCast"
  RMDir /r "$INSTDIR"
SectionEnd
