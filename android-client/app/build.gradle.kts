plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val devboardUrl = (project.findProperty("DEVBOARD_URL") as String?)
    ?: "https://SEU-DOMINIO-DEVBOARD"

android {
    namespace = "br.com.softwork.devboard"
    compileSdk = 36

    defaultConfig {
        applicationId = "br.com.softwork.devboard"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"

        buildConfigField("String", "DEVBOARD_URL", "\"${devboardUrl.replace("\\", "\\\\").replace("\"", "\\\"")}\"")
    }

    buildFeatures {
        buildConfig = true
        viewBinding = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.19.0")
    implementation("androidx.appcompat:appcompat:1.8.0")
    implementation("androidx.activity:activity-ktx:1.13.0")
    implementation("androidx.webkit:webkit:1.17.0")

    // WebRTC nativo pré-compilado. ScreenCapturerAndroid usa MediaProjection internamente.
    implementation("io.github.webrtc-sdk:android:144.7559.12")
}
