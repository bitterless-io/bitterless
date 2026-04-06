!macro preInit
  ; Kill existing process before installation to avoid file lock
  nsExec::ExecToLog 'taskkill /F /IM "Bitterless.exe" /T'
  Sleep 1000
!macroend
