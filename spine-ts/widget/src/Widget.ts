/******************************************************************************
 * Spine Runtimes Software License
 * Version 2.5
 * 
 * Copyright (c) 2013-2016, Esoteric Software
 * All rights reserved.
 * 
 * You are granted a perpetual, non-exclusive, non-sublicensable, and
 * non-transferable license to use, install, execute, and perform the Spine
 * Runtimes software and derivative works solely for personal or internal
 * use. Without the written permission of Esoteric Software (see Section 2 of
 * the Spine Software License Agreement), you may not (a) modify, translate,
 * adapt, or develop new applications using the Spine Runtimes or otherwise
 * create derivative works or improvements of the Spine Runtimes or (b) remove,
 * delete, alter, or obscure any trademarks or any copyright, trademark, patent,
 * or other intellectual property or proprietary rights notices on or in the
 * Software, including any copy thereof. Redistributions in binary or source
 * form must include this license and terms.
 * 
 * THIS SOFTWARE IS PROVIDED BY ESOTERIC SOFTWARE "AS IS" AND ANY EXPRESS OR
 * IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO
 * EVENT SHALL ESOTERIC SOFTWARE BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES, BUSINESS INTERRUPTION, OR LOSS OF
 * USE, DATA, OR PROFITS) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER
 * IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 *****************************************************************************/

module spine {
	export class SpineWidget {		
		skeleton: Skeleton;
		state: AnimationState;
		gl: WebGLRenderingContext;
		canvas: HTMLCanvasElement;		

		private _config: SpineWidgetConfig;
		private _assetManager: spine.webgl.AssetManager;
		private _shader: spine.webgl.Shader;
		private _batcher: spine.webgl.PolygonBatcher;
		private _mvp = new spine.webgl.Matrix4();
		private _skeletonRenderer: spine.webgl.SkeletonRenderer;		
		private _paused = false;
		private _lastFrameTime = Date.now() / 1000.0;
		private _backgroundColor = new Color();
		private _loaded = false;

		constructor (element: Element | string, config: SpineWidgetConfig) {
			if (!element) throw new Error("Please provide a DOM element, e.g. document.getElementById('myelement')");
			if (!config) throw new Error("Please provide a configuration, specifying at least the json file, atlas file and animation name");

			let elementId = element as string;
			if (typeof(element) === "string") element = document.getElementById(element as string);
			if (element == null) throw new Error(`Element ${elementId} does not exist`);

			this.validateConfig(config);

			let canvas = this.canvas = document.createElement("canvas");
			(<Element> element).appendChild(canvas);
			canvas.width = config.width;
			canvas.height = config.height;
			var webglConfig = { alpha: false };
			let gl = this.gl = <WebGLRenderingContext> (canvas.getContext("webgl", webglConfig) || canvas.getContext("experimental-webgl", webglConfig));	

			this._shader = spine.webgl.Shader.newColoredTextured(gl);
			this._batcher = new spine.webgl.PolygonBatcher(gl);
			this._mvp.ortho2d(0, 0, 639, 479);
			this._skeletonRenderer = new spine.webgl.SkeletonRenderer(gl);

			let assets = this._assetManager = new spine.webgl.AssetManager(gl);
			assets.loadText(config.atlas);
			assets.loadText(config.json);
			assets.loadTexture(config.atlas.replace(".atlas", ".png"));
			requestAnimationFrame(() => { this.load(); });
		}

		private validateConfig (config: SpineWidgetConfig) {
			if (!config.atlas) throw new Error("Please specify config.atlas");
			if (!config.json) throw new Error("Please specify config.json");
			if (!config.animation) throw new Error("Please specify config.animationName");

			if (!config.scale) config.scale = 1.0;
			if (!config.skin) config.skin = "default";
			if (config.loop === undefined) config.loop = true;			
			if (!config.y) config.y = 20;
			if (!config.width) config.width = 640;
			if (!config.height) config.height = 480;			
			if (!config.x) config.x = config.width / 2;
			if (!config.backgroundColor) config.backgroundColor = "#555555";
			if (!config.imagesPath) {
				let index = config.atlas.lastIndexOf("/");
				if (index != -1) {
					config.imagesPath = config.atlas.substr(0, index) + "/";
				} else {
					config.imagesPath = "";
				}
			}
			if (!config.premultipliedAlpha === undefined) config.premultipliedAlpha = false;
			this._backgroundColor.setFromString(config.backgroundColor);
			this._config = config;		
		}

		private load () {
			let assetManager = this._assetManager;
			let imagesPath = this._config.imagesPath;
			let config = this._config;
			if (assetManager.isLoadingComplete()) {
				if (assetManager.hasErrors()) {
					if (config.error) config.error(this, "Failed to load assets: " + JSON.stringify(assetManager.errors));
					else throw new Error("Failed to load assets: " + JSON.stringify(assetManager.errors));
				}

				let atlas = new spine.TextureAtlas(this._assetManager.get(this._config.atlas) as string, (path: string) => {
					let texture = assetManager.get(imagesPath + path) as spine.webgl.GLTexture;
					return texture;
				});
				
				let atlasLoader = new spine.TextureAtlasAttachmentLoader(atlas);				
				var skeletonJson = new spine.SkeletonJson(atlasLoader);
				
				// Set the scale to apply during parsing, parse the file, and create a new skeleton.
				skeletonJson.scale = config.scale;
				var skeletonData = skeletonJson.readSkeletonData(assetManager.get(config.json) as string);
				var skeleton = this.skeleton = new spine.Skeleton(skeletonData);
				skeleton.x = config.x;
				skeleton.y = config.y;
				skeleton.setSkinByName(config.skin);

				var animationState = this.state = new spine.AnimationState(new spine.AnimationStateData(skeleton.data));
				animationState.setAnimation(0, config.animation, true);
				if (config.success) config.success(this);
				this._loaded = true;
				requestAnimationFrame(() => { this.render(); });
			} else
				requestAnimationFrame(() => { this.load(); });
		}

		private render () {			
			var now = Date.now() / 1000;
			var delta = now - this._lastFrameTime;
			if (delta > 0.1) delta = 0;
			this._lastFrameTime = now;

			let gl = this.gl;
			let color = this._backgroundColor;
			gl.clearColor(color.r, color.g, color.b, color.a);
			gl.clear(gl.COLOR_BUFFER_BIT);

			// Apply the animation state based on the delta time.
			var state = this.state;
			var skeleton = this.skeleton;
			var premultipliedAlpha = this._config.premultipliedAlpha;
			state.update(delta);
			state.apply(skeleton);
			skeleton.updateWorldTransform();
			
			// Bind the shader and set the texture and model-view-projection matrix.
			let shader = this._shader;
			shader.bind();
			shader.setUniformi(spine.webgl.Shader.SAMPLER, 0);
			shader.setUniform4x4f(spine.webgl.Shader.MVP_MATRIX, this._mvp.values);

			// Start the batch and tell the SkeletonRenderer to render the active skeleton.
			let batcher = this._batcher;
			let skeletonRenderer = this._skeletonRenderer;
			batcher.begin(shader);
			skeletonRenderer.premultipliedAlpha = premultipliedAlpha;
			skeletonRenderer.draw(batcher, skeleton);
			batcher.end();
				
			shader.unbind();

			if (!this._paused) requestAnimationFrame(() => { this.render(); });
		}

		pause () {
			this._paused = true;
		}

		play () {
			this._paused = false;
			requestAnimationFrame(() => { this.render(); });
		}

		isPlaying () {
			return !this._paused;
		}

		setAnimation (animationName: string) {
			if (!this._loaded) throw new Error("Widget isn't loaded yet");
			this.skeleton.setToSetupPose();
			this.state.setAnimation(0, animationName, this._config.loop);
		}


		static loadWidgets() {
			let widgets = document.getElementsByClassName("spine-widget");
			for (var i = 0; i < widgets.length; i++) {
				SpineWidget.loadWidget(widgets[i]);				
			}
		}

		static loadWidget(widget: Element) {
			let config = new SpineWidgetConfig();
			config.atlas = widget.getAttribute("data-atlas");
			config.json = widget.getAttribute("data-json");
			config.animation = widget.getAttribute("data-animation");
			if (widget.getAttribute("data-images-path")) config.imagesPath = widget.getAttribute("data-images-path");			
			if (widget.getAttribute("data-skin")) config.skin = widget.getAttribute("data-skin");
			if (widget.getAttribute("data-loop")) config.loop = widget.getAttribute("data-loop") === "true";
			if (widget.getAttribute("data-scale")) config.scale = parseFloat(widget.getAttribute("data-scale"));
			if (widget.getAttribute("data-x")) config.x = parseFloat(widget.getAttribute("data-x"));
			if (widget.getAttribute("data-y")) config.x = parseFloat(widget.getAttribute("data-y"));
			if (widget.getAttribute("data-width")) config.width = parseInt(widget.getAttribute("data-width"));
			if (widget.getAttribute("data-height")) config.height = parseInt(widget.getAttribute("data-height"));			
			if (widget.getAttribute("data-background-color")) config.backgroundColor = widget.getAttribute("data-background-color");
			if (widget.getAttribute("data-premultiplied-alpha")) config.premultipliedAlpha = widget.getAttribute("data-premultiplied-alpha") === "true";			

			new spine.SpineWidget(widget, config);
		}

		static pageLoaded = false;
		private static ready () {
			if (SpineWidget.pageLoaded) return;
			SpineWidget.pageLoaded = true;
			SpineWidget.loadWidgets();
		}

		static setupDOMListener() {
			if (document.addEventListener) {
				document.addEventListener("DOMContentLoaded", SpineWidget.ready, false);
				window.addEventListener("load", SpineWidget.ready, false);
			} else {
				(<any>document).attachEvent("onreadystatechange", function readyStateChange() {
					if (document.readyState === "complete" ) SpineWidget.ready();
				});
				(<any>window).attachEvent("onload", SpineWidget.ready);
			}
		}
	}

	export class SpineWidgetConfig {
		json: string;
		atlas: string;
		animation: string;
		imagesPath: string;		
		skin = "default";		
		loop = true;
		scale = 1.0;
		x = 0;
		y = 0;
		width = 640;
		height = 480;		
		backgroundColor = "#555555";
		premultipliedAlpha = false;		
		success: (widget: SpineWidget) => void;
		error: (widget: SpineWidget, msg: string) => void;		
	}
}
spine.SpineWidget.setupDOMListener();