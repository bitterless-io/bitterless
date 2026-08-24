// Workbench needs the normal Maestro bridges plus connector runtimes. Keeping this dedicated
// preload prevents connector handlers from registering in Maestro's control/home WebContents.
import './coach.preload'
import '../connector/connector.preload'
