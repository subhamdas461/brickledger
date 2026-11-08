# kotlinx.serialization - keep generated serializers for @Serializable classes.
-keepattributes *Annotation*, InnerClasses, Signature, Exceptions
-dontnote kotlinx.serialization.AnnotationsKt
-keepclassmembers class kotlinx.serialization.json.** { *** Companion; }
-keepclasseswithmembers class kotlinx.serialization.json.** { kotlinx.serialization.KSerializer serializer(...); }
-keep,includedescriptorclasses class com.brickledger.app.**$$serializer { *; }
-keepclassmembers class com.brickledger.app.** { *** Companion; }
-keepclasseswithmembers class com.brickledger.app.** { kotlinx.serialization.KSerializer serializer(...); }

# Retrofit service interfaces are accessed reflectively.
-keep,allowobfuscation,allowshrinking interface com.brickledger.app.data.remote.ApiService
-keep,allowobfuscation,allowshrinking class kotlin.coroutines.Continuation
-keepattributes RuntimeVisibleAnnotations, RuntimeVisibleParameterAnnotations, AnnotationDefault

# OkHttp / Okio
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
