package com.brickledger.app.ui.navigation

import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import com.brickledger.app.AppContainer
import com.brickledger.app.ui.screens.CreateProjectScreen
import com.brickledger.app.ui.screens.EntityFormScreen
import com.brickledger.app.ui.screens.LoginScreen
import com.brickledger.app.ui.screens.MaterialScreen
import com.brickledger.app.ui.screens.ProjectHomeScreen
import com.brickledger.app.ui.screens.ProjectsScreen
import com.brickledger.app.ui.screens.RegisterScreen
import com.brickledger.app.ui.screens.RestoreBackupDialog
import com.brickledger.app.ui.screens.SectionScreen
import com.brickledger.app.ui.screens.SettingsScreen
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable

@Serializable object LoginRoute
@Serializable object RegisterRoute
@Serializable object ProjectsRoute
@Serializable object CreateProjectRoute
@Serializable object SettingsRoute
@Serializable data class ProjectRoute(val projectId: String)
@Serializable data class SectionRoute(val projectId: String, val section: String)
@Serializable data class FormRoute(val projectId: String, val kind: String, val id: String? = null, val parent: String? = null, val prefill: String? = null)
@Serializable data class MaterialRoute(val projectId: String, val materialId: String)

/**
 * Navigation from one screen, acting only while that screen is on top. A screen stays composed
 * (and tappable) while it animates away, so without this a double tap navigates twice - opening a
 * form twice, or popping past the first screen and leaving a blank app.
 */
open class ScreenNav(protected val nav: NavHostController, private val entry: NavBackStackEntry) {
    val isCurrent get() = nav.currentBackStackEntry === entry
    fun back() {
        if (isCurrent && nav.previousBackStackEntry != null) nav.popBackStack()
    }
    fun go(route: Any) {
        if (isCurrent) nav.navigate(route)
    }
}

/** Navigation helpers scoped to one project. */
class ProjectNav(nav: NavHostController, entry: NavBackStackEntry, val projectId: String) : ScreenNav(nav, entry) {
    fun form(kind: String, id: String? = null, parent: String? = null, prefill: String? = null) =
        go(FormRoute(projectId, kind, id, parent, prefill))
    fun section(section: String) = go(SectionRoute(projectId, section))
    fun material(id: String) = go(MaterialRoute(projectId, id))
    fun settings() = go(SettingsRoute)
    fun signIn() = go(LoginRoute)

    /** Opens another project in place of this one (e.g. after moving it to the cloud). Runs after async work, so unguarded. */
    fun openProject(id: String) = nav.navigate(ProjectRoute(id)) { popUpTo(ProjectsRoute) }

    /**
     * Back to the project list while this screen is still on top - a late "project gone" signal from a
     * screen that is animating away must not undo a navigation that already happened (e.g. to the moved project).
     */
    fun leave() {
        if (isCurrent) nav.navigate(ProjectsRoute) { popUpTo(ProjectsRoute) { inclusive = true } }
    }
}

@Composable
fun AppNavHost(container: AppContainer) {
    val nav = rememberNavController()
    val profile by container.session.profile.collectAsStateWithLifecycle()
    val offline by container.session.offlineMode.collectAsStateWithLifecycle()
    val startLoggedIn = remember { container.session.isActive }

    // Signed out (here or because the session was revoked): back to sign-in - unless the
    // phone is in offline mode, where the app keeps working without an account.
    LaunchedEffect(profile, offline) {
        if (profile == null && !offline && nav.currentDestination?.route?.contains("LoginRoute") != true && nav.currentDestination?.route?.contains("RegisterRoute") != true) {
            nav.navigate(LoginRoute) { popUpTo(nav.graph.id) { inclusive = true } }
        }
    }
    // Reopen the last project, keeping the project list underneath for Back.
    LaunchedEffect(Unit) {
        val last = container.session.lastProjectId
        if (startLoggedIn && last != null && container.db.projects().get(last) != null) nav.navigate(ProjectRoute(last))
    }

    val signedIn = { nav.navigate(ProjectsRoute) { popUpTo(nav.graph.id) { inclusive = true } } }
    NavHost(
        navController = nav,
        startDestination = if (startLoggedIn) ProjectsRoute else LoginRoute,
        enterTransition = { slideInHorizontally { it / 6 } + fadeIn() },
        exitTransition = { fadeOut() },
        popEnterTransition = { fadeIn() },
        popExitTransition = { slideOutHorizontally { it / 6 } + fadeOut() },
    ) {
        composable<LoginRoute> { entry ->
            val to = remember(entry) { ScreenNav(nav, entry) }
            LoginScreen(container, onSignedIn = signedIn, onRegister = { to.go(RegisterRoute) })
        }
        composable<RegisterRoute> { entry ->
            val to = remember(entry) { ScreenNav(nav, entry) }
            RegisterScreen(container, onSignedIn = signedIn, onBack = to::back)
        }
        composable<ProjectsRoute> { entry ->
            val to = remember(entry) { ScreenNav(nav, entry) }
            ProjectsScreen(
                container,
                onOpen = { to.go(ProjectRoute(it)) },
                onCreate = { to.go(CreateProjectRoute) },
                onSettings = { to.go(SettingsRoute) },
                onSignIn = { to.go(LoginRoute) },
                onRegister = { to.go(RegisterRoute) },
            )
        }
        composable<CreateProjectRoute> { entry ->
            val to = remember(entry) { ScreenNav(nav, entry) }
            CreateProjectScreen(container, onBack = to::back, onCreated = { id ->
                nav.navigate(ProjectRoute(id)) { popUpTo(ProjectsRoute) }
            })
        }
        composable<ProjectRoute> { entry ->
            val pn = remember(entry) { ProjectNav(nav, entry, entry.toRoute<ProjectRoute>().projectId) }
            ProjectHomeScreen(container, pn)
        }
        composable<SectionRoute> { entry ->
            val route = entry.toRoute<SectionRoute>()
            val pn = remember(entry) { ProjectNav(nav, entry, route.projectId) }
            SectionScreen(container, pn, route.section)
        }
        composable<FormRoute> { entry ->
            val to = remember(entry) { ScreenNav(nav, entry) }
            EntityFormScreen(container, entry.toRoute<FormRoute>(), onDone = to::back)
        }
        composable<MaterialRoute> { entry ->
            val route = entry.toRoute<MaterialRoute>()
            val pn = remember(entry) { ProjectNav(nav, entry, route.projectId) }
            MaterialScreen(container, pn, route.materialId)
        }
        composable<SettingsRoute> { entry ->
            val to = remember(entry) { ScreenNav(nav, entry) }
            SettingsScreen(container, onBack = to::back, onSignIn = { to.go(LoginRoute) })
        }
    }

    // A backup opened from another app, or picked on the sign-in, project list or Settings screen.
    val incoming by container.backupInbox.state.collectAsStateWithLifecycle()
    incoming?.let { state ->
        RestoreBackupDialog(
            state,
            onRestore = {
                // App scope: the restore finishes even if the screen changes underneath.
                container.appScope.launch {
                    val project = container.backupInbox.confirm() ?: return@launch
                    withContext(Dispatchers.Main) {
                        nav.navigate(ProjectsRoute) { popUpTo(nav.graph.id) { inclusive = true } }
                        nav.navigate(ProjectRoute(project.id))
                    }
                }
            },
            onDismiss = { container.backupInbox.discard() },
        )
    }
}
