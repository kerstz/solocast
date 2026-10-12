; SoloCast.exe : lanceur sans fenêtre de console. Démarre node.exe caché sur solocast.mjs.
; Remplace l'ancien solocast.vbs (VBScript est en voie de retrait et souvent bloqué).
; Construit par scripts/package.mjs avec -DOUTFILE -DICON -DVERSION -DVERSION4.
Unicode true
ManifestDPIAware true
RequestExecutionLevel user
SilentInstall silent
Icon "${ICON}"
OutFile "${OUTFILE}"
Name "SoloCast"

VIProductVersion "${VERSION4}"
VIAddVersionKey "ProductName" "SoloCast"
VIAddVersionKey "FileDescription" "SoloCast"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"

Section
  IfFileExists "$EXEDIR\node.exe" +3 0
    MessageBox MB_ICONSTOP "SoloCast est incomplet : réinstallez-le."
    Quit
  ; Une variable NODE_OPTIONS héritée de l'environnement pourrait casser ou détourner le lancement.
  System::Call 'kernel32::SetEnvironmentVariable(t "NODE_OPTIONS", p 0)i'
  SetOutPath "$EXEDIR"
  ExecShell "open" "$EXEDIR\node.exe" '"$EXEDIR\solocast.mjs"' SW_HIDE
SectionEnd
