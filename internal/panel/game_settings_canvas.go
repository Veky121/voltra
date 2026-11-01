package panel

const canvasSettingsRecipe = "minecraft/java/canvas-mc/egg-canvas-mc.json"

func canvasDifficultyPresentation(field M) {
	if str(field["key"]) == "difficulty" {
		field["label"] = "New-world difficulty"
		field["description"] = "Sets the difficulty for newly created worlds."
	}
}

func canvasDifficultyHelp() M {
	return M{"label": "Existing-world difficulty", "text": "Existing worlds can keep their saved difficulty. Use the console command execute in <dimension> run difficulty <value> for each world you want to change. The standard dimensions are minecraft:overworld, minecraft:the_nether and minecraft:the_end. Query each dimension with execute in <dimension> run difficulty to confirm the change."}
}
