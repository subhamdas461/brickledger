package com.brickledger.app.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private val Light = lightColorScheme(
    primary = Color(0xFFC2410C),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFFFEDD5),
    onPrimaryContainer = Color(0xFF431407),
    secondary = Color(0xFF57534E),
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFF1EFEC),
    onSecondaryContainer = Color(0xFF292524),
    tertiary = Color(0xFF2A78D6),
    onTertiary = Color.White,
    tertiaryContainer = Color(0xFFDCEBFC),
    onTertiaryContainer = Color(0xFF0D366B),
    background = Color(0xFFFAFAF9),
    onBackground = Color(0xFF1C1917),
    surface = Color(0xFFFAFAF9),
    onSurface = Color(0xFF1C1917),
    surfaceVariant = Color(0xFFF1EFEC),
    onSurfaceVariant = Color(0xFF57534E),
    surfaceContainerLowest = Color.White,
    surfaceContainerLow = Color(0xFFFFFFFF),
    surfaceContainer = Color(0xFFF5F5F4),
    surfaceContainerHigh = Color(0xFFEFEEEC),
    surfaceContainerHighest = Color(0xFFE7E5E4),
    outline = Color(0xFFD6D3D1),
    outlineVariant = Color(0xFFE7E5E4),
    error = Color(0xFFD03B3B),
    onError = Color.White,
    errorContainer = Color(0xFFFDECEC),
    onErrorContainer = Color(0xFF7F1D1D),
)

private val Dark = darkColorScheme(
    primary = Color(0xFFFB923C),
    onPrimary = Color(0xFF431407),
    primaryContainer = Color(0xFF7C2D12),
    onPrimaryContainer = Color(0xFFFFEDD5),
    secondary = Color(0xFFD6D3D1),
    onSecondary = Color(0xFF1C1917),
    secondaryContainer = Color(0xFF292524),
    onSecondaryContainer = Color(0xFFE7E5E4),
    tertiary = Color(0xFF3987E5),
    onTertiary = Color.White,
    tertiaryContainer = Color(0xFF16304F),
    onTertiaryContainer = Color(0xFFDCEBFC),
    background = Color(0xFF0F0E0D),
    onBackground = Color(0xFFF5F5F4),
    surface = Color(0xFF0F0E0D),
    onSurface = Color(0xFFF5F5F4),
    surfaceVariant = Color(0xFF292524),
    onSurfaceVariant = Color(0xFFA8A29E),
    surfaceContainerLowest = Color(0xFF0C0A09),
    surfaceContainerLow = Color(0xFF1C1917),
    surfaceContainer = Color(0xFF1C1917),
    surfaceContainerHigh = Color(0xFF26221F),
    surfaceContainerHighest = Color(0xFF2E2A27),
    outline = Color(0xFF44403C),
    outlineVariant = Color(0xFF292524),
    error = Color(0xFFE66767),
    onError = Color.White,
    errorContainer = Color(0xFF3D1414),
    onErrorContainer = Color(0xFFFECACA),
)

/** Data-viz tokens (validated reference palette, light/dark steps) + status colours. */
@Immutable
data class ChartColors(
    val series: List<Color>,
    val other: Color,
    val track: Color,
    val grid: Color,
    val baseline: Color,
    val muted: Color,
    val good: Color,
    val warning: Color,
    val serious: Color,
    val critical: Color,
)

private val LightChart = ChartColors(
    series = listOf(Color(0xFF2A78D6), Color(0xFFEB6834), Color(0xFF1BAF7A), Color(0xFFEDA100), Color(0xFFE87BA4), Color(0xFF008300)),
    other = Color(0xFFB7B5AD),
    track = Color(0xFFDCEBFC),
    grid = Color(0xFFE1E0D9),
    baseline = Color(0xFFC3C2B7),
    muted = Color(0xFF898781),
    good = Color(0xFF0CA30C),
    warning = Color(0xFFFAB219),
    serious = Color(0xFFEC835A),
    critical = Color(0xFFD03B3B),
)

private val DarkChart = LightChart.copy(
    series = listOf(Color(0xFF3987E5), Color(0xFFD95926), Color(0xFF199E70), Color(0xFFC98500), Color(0xFFD55181), Color(0xFF008300)),
    other = Color(0xFF5C5A55),
    track = Color(0xFF16304F),
    grid = Color(0xFF2C2C2A),
    baseline = Color(0xFF383835),
)

val LocalChartColors = staticCompositionLocalOf { LightChart }

private val AppTypography = Typography().let { t ->
    t.copy(
        headlineLarge = t.headlineLarge.copy(fontWeight = FontWeight.SemiBold, letterSpacing = (-0.5).sp),
        headlineMedium = t.headlineMedium.copy(fontWeight = FontWeight.SemiBold, letterSpacing = (-0.4).sp),
        headlineSmall = t.headlineSmall.copy(fontWeight = FontWeight.SemiBold, letterSpacing = (-0.2).sp),
        titleLarge = t.titleLarge.copy(fontWeight = FontWeight.SemiBold),
        titleMedium = t.titleMedium.copy(fontWeight = FontWeight.SemiBold),
        labelLarge = t.labelLarge.copy(fontWeight = FontWeight.SemiBold),
    )
}

/** Large standalone figure (hero number) - same sans as everything else. */
val HeroNumber = TextStyle(fontSize = 40.sp, lineHeight = 44.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-1).sp)

private val AppShapes = Shapes(
    extraSmall = RoundedCornerShape(8.dp),
    small = RoundedCornerShape(12.dp),
    medium = RoundedCornerShape(16.dp),
    large = RoundedCornerShape(24.dp),
    extraLarge = RoundedCornerShape(28.dp),
)

@Composable
fun BrickLedgerTheme(darkTheme: Boolean, content: @Composable () -> Unit) {
    androidx.compose.runtime.CompositionLocalProvider(LocalChartColors provides if (darkTheme) DarkChart else LightChart) {
        MaterialTheme(
            colorScheme = if (darkTheme) Dark else Light,
            typography = AppTypography,
            shapes = AppShapes,
            content = content,
        )
    }
}
