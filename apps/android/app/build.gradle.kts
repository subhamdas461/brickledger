import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
}

// Instant phone notifications (Firebase): the values in app/google-services.json for each build's own package.
// Read here instead of by Google's plugin, which fails any build whose package isn't in the file (e.g. debug
// before it is added in Firebase). Such a build still works; it checks for team updates every 15 minutes.
@Suppress("UNCHECKED_CAST")
val firebaseClients: Map<String, Map<String, String>> = file("google-services.json").takeIf { it.exists() }?.let { f ->
    val json = groovy.json.JsonSlurper().parse(f) as Map<String, Any?>
    val project = json["project_info"] as Map<String, Any?>
    (json["client"] as List<Map<String, Any?>>).associate { c ->
        val info = c["client_info"] as Map<String, Any?>
        val pkg = (info["android_client_info"] as Map<String, Any?>)["package_name"] as String
        pkg to mapOf(
            "google_app_id" to info["mobilesdk_app_id"] as String,
            "google_api_key" to ((c["api_key"] as List<Map<String, Any?>>).first()["current_key"] as String),
            "gcm_defaultSenderId" to project["project_number"].toString(),
            "project_id" to project["project_id"] as String,
            "google_storage_bucket" to (project["storage_bucket"] as String? ?: ""),
        )
    }
} ?: emptyMap()

// Release signing: create apps/android/keystore.properties (see README) - never commit it.
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "com.brickledger.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.brickledger.app"
        minSdk = 26
        targetSdk = 36
        // Raised by `npm run release:android` (see gradle.properties). Phones only update to a higher versionCode.
        versionCode = ((project.findProperty("brickledger.versionCode") as String?) ?: "1").toInt()
        versionName = (project.findProperty("brickledger.versionName") as String?) ?: "1.0.0"
        // Production address (gradle.properties: brickledger.productionUrl). The website and the API
        // are served from the same address (Vercel, or the Docker image with SERVE_WEB=true).
        val productionUrl = ((project.findProperty("brickledger.productionUrl") as String?) ?: "https://brickledger.app").trimEnd('/')
        buildConfigField("String", "DEFAULT_API_URL", "\"$productionUrl/\"")
        buildConfigField("String", "WEB_URL", "\"$productionUrl\"")
        // Invitation links (https://<host>/invite/<token>) open the app.
        manifestPlaceholders["inviteHost"] = productionUrl.substringAfter("://").substringBefore("/").substringBefore(":")
        vectorDrawables { useSupportLibrary = true }
    }

    signingConfigs {
        if (keystoreProps.isNotEmpty()) {
            create("release") {
                storeFile = rootProject.file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        debug {
            // -Pbrickledger.debugSuffix= builds debug as com.brickledger.app (e.g. to try instant notifications
            // before adding the .debug app in Firebase); uninstall the release app first, it's signed differently.
            applicationIdSuffix = (project.findProperty("brickledger.debugSuffix") as String?) ?: ".debug"
            versionNameSuffix = "-debug"
            // 10.0.2.2 is the host machine as seen from the Android emulator. Override for a phone on
            // your LAN with: ./gradlew installDebug -Pbrickledger.apiUrl=http://192.168.1.20:4000/
            val apiUrl = (project.findProperty("brickledger.apiUrl") as String?) ?: "http://10.0.2.2:4000/"
            buildConfigField("String", "DEFAULT_API_URL", "\"$apiUrl\"")
            buildConfigField("String", "WEB_URL", "\"http://10.0.2.2:5173\"")
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
        // QA build: identical to release (R8-minified) but debug-signed and allowed to talk to a test server.
        create("staging") {
            initWith(getByName("release"))
            applicationIdSuffix = ".staging"
            versionNameSuffix = "-staging"
            signingConfig = signingConfigs.getByName("debug")
            matchingFallbacks += listOf("release")
            val apiUrl = (project.findProperty("brickledger.apiUrl") as String?) ?: "http://10.0.2.2:4000/"
            buildConfigField("String", "DEFAULT_API_URL", "\"$apiUrl\"")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    packaging {
        resources { excludes += "/META-INF/{AL2.0,LGPL2.1}" }
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
        optIn.addAll(
            "androidx.compose.material3.ExperimentalMaterial3Api",
            "androidx.compose.foundation.layout.ExperimentalLayoutApi",
            "kotlinx.coroutines.ExperimentalCoroutinesApi",
        )
    }
}

ksp {
    arg("room.schemaLocation", "$projectDir/schemas")
    arg("room.generateKotlin", "true")
}

dependencies {
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.core.splashscreen)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.process)
    implementation(libs.androidx.navigation.compose)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons.extended)
    debugImplementation(libs.androidx.compose.ui.tooling)

    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    ksp(libs.androidx.room.compiler)
    implementation(libs.androidx.work.runtime.ktx)
    implementation(libs.androidx.datastore.preferences)

    implementation(libs.retrofit)
    implementation(libs.retrofit.kotlinx.serialization)
    implementation(libs.okhttp)
    implementation(libs.okhttp.logging)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.coil.compose)
    implementation(libs.coil.network.okhttp)
}

androidComponents {
    onVariants { variant ->
        val values = firebaseClients[variant.applicationId.get()] ?: return@onVariants
        values.forEach { (name, value) -> variant.resValues.put(variant.makeResValueKey("string", name), com.android.build.api.variant.ResValue(value, "Firebase")) }
    }
}
