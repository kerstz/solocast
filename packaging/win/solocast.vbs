' Lance SoloCast sans fenêtre de console : tout se pilote depuis le site (studio).
' Le dossier d'installation est celui de ce script.
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = dir
shell.Run """" & dir & "\node.exe"" """ & dir & "\solocast.mjs""", 0, False
