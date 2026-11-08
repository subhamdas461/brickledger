package com.brickledger.app.core

/** Template budget head that wage payments default to (see packages/shared/src/templates.ts). */
const val LABOUR_CATEGORY = "Labour & wages"

/**
 * Domain vocabularies - mirror of packages/shared/src/constants.ts (keep in sync).
 * Each is an ordered list of value -> label pairs.
 */
object Vocab {
    val projectStatus = listOf("planning" to "Planning", "in_progress" to "In progress", "on_hold" to "On hold", "completed" to "Completed")
    val projectRoles = listOf("manager" to "Manager", "contributor" to "Contributor", "viewer" to "Viewer")
    val paymentModes = listOf("cash" to "Cash", "upi" to "UPI", "bank_transfer" to "Bank transfer", "cheque" to "Cheque", "card" to "Card", "other" to "Other")
    val expenseStatus = listOf("paid" to "Paid", "due" to "Bill due")
    val vendorTypes = listOf(
        "supplier" to "Material supplier", "contractor" to "Contractor", "labour_contractor" to "Labour contractor",
        "consultant" to "Architect / engineer", "service" to "Service provider", "other" to "Other",
    )
    val materialCategories = listOf(
        "cement" to "Cement", "steel" to "Steel", "sand" to "Sand", "aggregate" to "Aggregate", "bricks_blocks" to "Bricks & blocks",
        "tiles_stone" to "Tiles & stone", "wood" to "Wood", "paint" to "Paint", "electrical" to "Electrical", "plumbing" to "Plumbing",
        "hardware" to "Hardware", "other" to "Other",
    )
    val units = listOf("bags", "kg", "ton", "cft", "cum", "brass", "nos", "sqft", "sqm", "rft", "ltr", "trip", "box", "set").map { it to it }
    val trades = listOf(
        "mason" to "Mason", "helper" to "Helper", "carpenter" to "Carpenter", "bar_bender" to "Bar bender", "electrician" to "Electrician",
        "plumber" to "Plumber", "painter" to "Painter", "tiler" to "Tile layer", "welder" to "Welder", "supervisor" to "Supervisor", "other" to "Other",
    )
    val attendance = listOf("present" to "Present", "half" to "Half day", "absent" to "Absent")
    val taskStatus = listOf("todo" to "To do", "in_progress" to "In progress", "blocked" to "Blocked", "done" to "Done")
    val priorities = listOf("low" to "Low", "medium" to "Medium", "high" to "High", "urgent" to "Urgent")
    val phaseStatus = listOf("not_started" to "Not started", "in_progress" to "In progress", "on_hold" to "On hold", "completed" to "Completed")
    val weather = listOf("sunny" to "Sunny", "cloudy" to "Cloudy", "rainy" to "Rainy", "stormy" to "Stormy", "hot" to "Very hot", "cold" to "Cold")
    val fundSources = listOf(
        "savings" to "Own savings", "home_loan" to "Home loan", "family" to "Family / friends",
        "investor" to "Investor / partner", "client" to "Client payment", "other" to "Other",
    )
    val severities = listOf("low" to "Low", "medium" to "Medium", "high" to "High", "critical" to "Critical")
    val issueStatus = listOf("open" to "Open", "in_progress" to "In progress", "resolved" to "Resolved")
    val fileCategories = listOf(
        "drawing" to "Drawing / plan", "permit" to "Permit / approval", "contract" to "Contract", "invoice" to "Invoice / bill",
        "receipt" to "Receipt", "photo" to "Site photo", "warranty" to "Warranty", "report" to "Report", "other" to "Other",
    )
    val areaUnits = listOf("sqft" to "sq ft", "sqm" to "sq m")

    fun label(list: List<Pair<String, String>>, value: String?): String = list.firstOrNull { it.first == value }?.second ?: value.orEmpty()
}
