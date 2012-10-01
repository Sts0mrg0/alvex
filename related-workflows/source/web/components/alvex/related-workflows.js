/**
 * Copyright © 2012 ITD Systems
 *
 * This file is part of Alvex
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

// Ensure root object exists
if (typeof Alvex == "undefined" || !Alvex)
{
	var Alvex = {};
}

(function()
{
	Alvex.RelatedWorkflows = function(htmlId)
	{
		Alvex.RelatedWorkflows.superclass.constructor.call(this, "Alvex.RelatedWorkflows", htmlId);
		return this;
	};

	YAHOO.extend(Alvex.RelatedWorkflows, Alfresco.component.Base,
	{
		options:
		{
			// List of related workflows
			relatedWorkflows: [],
			// Workflow definitions that are allowed to start from this task - by def names
			definitionsFilter: '',
			// Property of the task where related workflows are stored
			propName: '',
			// Current task ID
			curTaskId: '',
			// If the control is disabled
			disabled: false,
			// List of workflows current user is allowed to start
			allowedWorkflows: [],
			dataSource: null,
			dataTable: null,
			actionUrl: null,
			urlAuto: true,
			mode: null
		},

		onReady: function RelWf_init()
		{
			this.options.definitionsFilter = this.options.definitionsFilter.replace(/\$/,"\\\$");
			if(!this.options.disabled)
			{
				this.createComboBox();
			}
			if (this.options.urlAuto && this.options.mode != 'view')
			{
				this.options.actionUrl = Alvex.util.getFormElement(this.id).action;
			}	

			if(! this.options.parentUploaderId )
				this.options.parentUploaderId = '*';

			// Create empty table of related workflows
			this.createDataTable();

			this.update();
		},

		// Fills list of possible related workflows to start
		createComboBox: function RelWf_fillComboBox()
		{
			var urlDefs = YAHOO.lang.substitute(
				"{proxy}api/alvex/list-definitions?filter={filter}",
				{
					proxy: Alfresco.constants.PROXY_URI,
					filter: encodeURIComponent( this.options.definitionsFilter)
				}
				);

			var urlAllowed = YAHOO.lang.substitute(
				"{proxy}api/alvex/workflow-shortcut/allowed-workflows",
				{
					proxy: Alfresco.constants.PROXY_URI
				}
				);

			Alvex.util.processAjaxQueue({
				queue: [
					{
						url: urlAllowed,
						responseContentType: Alfresco.util.Ajax.JSON,
						successCallback: {
							fn: function(response)
							{
								this.options.allowedWorkflows = response.json.workflows;
							},
							scope: this
						}
					},
					{
						url: urlDefs,
						responseContentType: Alfresco.util.Ajax.JSON,
						successCallback: {
							fn: function(response)
							{
								var menuItems = [];
								for (var key in response.json.data)  {
									var task = response.json.data[key];
									for (var i in this.options.allowedWorkflows)
										if(this.options.allowedWorkflows[i].name == task.name)
											menuItems.push({
												text: task.title,
												value: task.name
											});
								}
								(new YAHOO.widget.Button(
									this.id + "-cntrl-workflow-start",
									{
										type: "menu",
										menu: menuItems
									}
									)).getMenu().subscribe("click", this.startWorkflow, null, this)
							},
							scope: this
						}						
					}
				]
			});
		},

		// Starts new related workflow
		startWorkflow: function RelWf_startWorkflow( p_sType, p_aArgs )
		{
			var oEvent = p_aArgs[0];	//  DOM event from the menu
			var oMenuItem = p_aArgs[1];	//  Target of the event (selected workflow)

			// Get selected workflow, 'def' is workflow definition name
			var def = "";
			if (oMenuItem) { 
				def = oMenuItem.value;
			} else {
				return;
			}

			// Custom template URL for the dialog
			var templateUrl = YAHOO.lang.substitute(
				Alfresco.constants.URL_SERVICECONTEXT 
				+ "components/form?itemKind={itemKind}&itemId={itemId}&mode={mode}&submitType={submitType}&formId={formId}&showCancelButton=true",
				{
					itemKind: "workflow",
					itemId: def,
					mode: "create",
					submitType: "json",
					formId: "popupDialogForm"	// Custom dialog form
				});

			// Create new dialog

			// It looks like 'destroyOnHide: true' works globally for all dialogs on the page - do not use it
			// We still delete dialog manually because we are to clear the form and everything around it
			if( this.widgets.dialog )
				delete this.widgets.dialog;

			this.widgets.dialog = new Alfresco.module.SimpleDialog(this.id + "-cntrl-popup-dialog");

			this.widgets.dialog.setOptions(
			{
				width: "50em",			// TODO make it configurable or relative
				templateUrl: templateUrl,	// Our custom template URL
				actionUrl: null,
				destroyOnHide: false,

				// Before dialog show we just set its title
				doBeforeDialogShow:
				{
					fn: function RelWf_customizeDialogProperties(p_form, p_dialog)
					{
						Alfresco.util.populateHTML([
							p_dialog.id + "-dialogTitle", 
							Alfresco.util.message(this.msg("alvex.related_workflows.new_workflow_dialog_title"))
							]);
					},
					scope: this
				},

				// It is called when dialog is closed with success.
				// It means child workflow was started successfully and we got the response.
				onSuccess:
				{
					fn: function RelWf_dialog_on_success(response, p_obj)
					{
						// Get workflow description from the form
						// TODO - hardcoded property name, move it to the config (?)
						var desc = response.config.dataObj.prop_bpm_workflowDescription;
						var id = response.json.persistedObject.replace('WorkflowInstance[id=','').split(',')[0];
						// Save workflow details, update server state and UI
						this.commitCreatedWorkflow(desc, id);
					},
					scope: this
				},

				onFailure:
				{
					fn: function RelWf_dialog_on_failure(response)
					{
					// Do nothing
					},
					scope: this
				}
			}).show();
		},

		// Creates empty datatable of related workflows
		// Datatable is created once and updated after it
		createDataTable: function RelWf_createDataTable()
		{
			var me = this;
			
			// Hook action events
			var fnActionHandler = function fnActionHandler(layer, args)
			{
				var owner = YAHOO.Bubbling.getOwnerByTagName(args[1].anchor, "div");
				if (owner !== null)
				{
					if (typeof me[owner.className] == "function")
					{
						args[1].stop = true;
						var asset = me.options.dataTable.getRecord(args[1].target.offsetParent).getData();
						me[owner.className].call(me, asset, owner);
					}
				}
				return true;
			};
			YAHOO.Bubbling.addDefaultAction(this.id + "-action-link", fnActionHandler);

			// Columns defs
			var columnDefs =
			[
				{
					key: '',
					label: this.msg("alvex.related_workflows.workflow"),
					sortable:false,
					resizeable:true,
					width:250,
					formatter: this.formatDescriptionField
				},

				{
					key:"start_date",
					label: this.msg("alvex.related_workflows.start_date"),
					sortable:false,
					resizeable:true,
					width:125,
					formatter: this.formatStartDateField
				},

				{
					key:"status",
					label: this.msg("alvex.related_workflows.progress"),
					sortable:false,
					resizeable:true,
					width:125,
					formatter: this.formatStatusField
				},
				{
					key:"assignees",
					label: this.msg("alvex.related_workflows.persons_in_charge"),
					sortable:false,
					resizeable:true,
					width:100,
					formatter: this.formatAssigneesField
				},

				{
					key: '',
					label: this.msg('alvex.related_workflows.actions'),
					sortable:false,
					resizeable:true,
					width:100,
					formatter: this.formatActionsField
				}
			];

			// Use our list of related workflows as datasource
			var url = YAHOO.lang.substitute(
				"{proxy}/api/alvex/related-workflows?taskId={id}&propName={prop}",
				{
					proxy: Alfresco.constants.PROXY_URI,
					id: this.options.curTaskId,
					prop: this.options.propName
				}
			);
			this.options.dataSource = new YAHOO.util.DataSource(url);
			this.options.dataSource.responseType = YAHOO.util.DataSource.TYPE_JSON;
			this.options.dataSource.responseSchema = {
				resultsList: 'workflows',
				fields: [
					'id',
					'status',
					'description',
					'start_date',
					'end_date',
					'assignees'
				]
			};
			this.options.dataSource.maxCacheEntries = 0;

			// Create the table
			this.options.dataTable = new YAHOO.widget.DataTable(
				this.id + "-cntrl-dataTableContainer", columnDefs, this.options.dataSource,
				{
					selectionMode:"single",
					renderLoopSize: 32,
					MSG_EMPTY: this.msg('alvex.related_workflows.no_related_workflows')
				});
			this.options.dataTable.relatedWorkflows = this;
		    this.options.dataTable.showTableMessage(
				this.msg('alvex.related_workflows.loading'),
				YAHOO.widget.DataTable.CLASS_LOADING
			);
				
			// Enable row highlighting
			this.options.dataTable.subscribe("rowMouseoverEvent", this.onEventHighlightRow, this, true);
			this.options.dataTable.subscribe("rowMouseoutEvent", this.onEventUnhighlightRow, this, true);
		},


		// Save newly created workflow details and update everything
		commitCreatedWorkflow: function RelWf_commitCreatedWorkflow(desc, id)
		{
			// Save to the form - add new id to the field with ids of related workflows
			var curRelatedWorkflows = document.getElementById(this.id);
			if (curRelatedWorkflows.value == '')
				curRelatedWorkflows.value = id;
			else
				curRelatedWorkflows.value += ',' + id;

			var dataObj = {};
			dataObj[this.options.propName] = curRelatedWorkflows.value;
			Alfresco.util.Ajax.jsonRequest({
				url: this.options.actionUrl,
				method: Alfresco.util.Ajax.POST,
				dataObj: dataObj,
				successCallback:
				{
					fn: function ()
					{
						this.update();
					},
					scope:this
				}
			});
		},

		update: function ()
		{
			this.options.dataSource.sendRequest(
				null,
				{
					success: this.options.dataTable.onDataReturnInitializeTable, 
					scope: this.options.dataTable
				}
			);
		},

		formatDescriptionField: function (elLiner, oRecord, oColumn, oData)
		{
			elLiner.innerHTML = YAHOO.lang.substitute(
				'<a href="{page}/workflow-details?workflowId={id}">{descr}</a>',
				{
					page: Alfresco.constants.URL_PAGECONTEXT,
					id: oRecord._oData.id,
					descr: YAHOO.lang.escapeHTML(oRecord._oData.description)
				}
			);
		},

		formatStartDateField: function (elLiner, oRecord, oColumn, oData)
		{
			elLiner.innerHTML = Alvex.util.niceDateTimeString(oData);
		},

		formatStatusField: function (elLiner, oRecord, oColumn, oData)
		{
			elLiner.innerHTML = {
				'in-progress': this.relatedWorkflows.msg("alvex.related_workflows.in_progress"),
				'complete': this.relatedWorkflows.msg("alvex.related_workflows.complete")
				+ " (" + Alvex.util.niceDateTimeString(oRecord._oData.end_date) + ")"
			}[oData];
		},

		formatAssigneesField: function (elLiner, oRecord, oColumn, oData)
		{
			for (var idx in oData)
			{
				var person = oData[idx];
				elLiner.innerHTML += YAHOO.lang.substitute(
					'<a href="{page}user/{user}/profile">{firstName} {lastName}</a><br/>',
					{
						page: Alfresco.constants.URL_PAGECONTEXT,
						user: person.userName,
						firstName: person.firstName,
						lastName: person.lastName
					}
				);
			}
		},

		formatActionsField: function (elLiner, oRecord, oColumn, oData)
		{
			var clb, msg;
			var id = this.relatedWorkflows.id;
			var html = '<div id="' + id + '-actions-' + oRecord.getId() + '" class="hidden action">';
			
			msg = this.relatedWorkflows.msg('alvex.related_workflows.retrieve');
			if (oRecord._oData.status == 'complete')
				clb = 'retrieveDocuments';
			else
				clb = 'retrieveDocumentsDisabled';
			
			html += '<div class="' + clb + '"><a rel="cancel" href="" ' 
					+ 'class="related-workflows-action-link ' + id + '-action-link"'
					+ 'title="' + msg +'"><span>' + msg + '</span></a></div>';
			
			msg = this.relatedWorkflows.msg('alvex.related_workflows.cancel');
			if (oRecord._oData.status == 'in-progress')
				clb = 'cancelWorkflow';
			else
				clb = 'cancelWorkflowDisabled';

			html += '<div class="' + clb + '"><a rel="cancel" href="" ' 
					+ 'class="related-workflows-action-link ' + id + '-action-link"'
					+ 'title="' + msg +'"><span>' + msg + '</span></a></div>';

			html += '</div>';

			elLiner.innerHTML = html;
		},

		onEventHighlightRow: function DataGrid_onEventHighlightRow(oArgs)
		{
			// Call through to get the row highlighted by YUI
			// this.widgets.dataTable.onEventHighlightRow.call(this.widgets.dataTable, oArgs);

			var elActions = Dom.get(this.id + "-actions-" + oArgs.target.id);
			Dom.removeClass(elActions, "hidden");
		},

		onEventUnhighlightRow: function DataGrid_onEventUnhighlightRow(oArgs)
		{
			// Call through to get the row unhighlighted by YUI
			// this.widgets.dataTable.onEventUnhighlightRow.call(this.widgets.dataTable, oArgs);

			var elActions = Dom.get(this.id + "-actions-" + (oArgs.target.id));
			Dom.addClass(elActions, "hidden");
		},


		cancelWorkflow: function (obj)
		{
			Alfresco.util.PopupManager.displayPrompt(
			{
				title: this.msg("alvex.related_workflows.cancel_title"),
				text: this.msg("alvex.related_workflows.cancel_text"),
				buttons:
				[
					{
						text: this.msg("alvex.related_workflows.yes"),
						handler: (function(rw, obj){
							return function()
							{
								var url=YAHOO.lang.substitute(
									'{proxy}/api/workflow-instances/{id}',
									{
										proxy:Alfresco.constants.PROXY_URI,
										id:obj.id
									}
								);
								Alfresco.util.Ajax.jsonRequest({
									url:url,
									method:Alfresco.util.Ajax.DELETE,
									successCallback:
									{
										fn:function()
										{
											rw.update();
										}
									}
								});
								this.destroy();
							}
						})(this,obj)
					},
					{
						text:this.msg("alvex.related_workflows.no"),
						handler:function()
						{
							this.destroy();
						},
						isDefault:true
					}
				]
			});
		},

		retrieveDocuments: function (obj)
		{
			Alvex.util.processAjaxQueue({
				queue: [
					{
						url: Alfresco.constants.PROXY_URI+'api/workflow-instances/'+obj.id,
				        responseContentType: Alfresco.util.Ajax.JSON,
						successCallback: {
							fn: function (response)
							{
								// build url for the next query
								var ref = response.json.data['package'].match(new RegExp('(.*)://(.*)/(.*)'))
;								var url = YAHOO.lang.substitute(
									'{proxy}api/node/{protocol}/{storeId}/{nodeId}/children?filter=cmis:objectId',
									{
										proxy: Alfresco.constants.PROXY_URI,
										protocol: ref[1],
										storeId: ref[2],
										nodeId: ref[3]
									}
								);
								response.config.config.queue[1].url = url;
							},
							scope: this
						}
					},
					{
						url: null,
						successCallback: {
							fn: function (response)
							{
								// FIXME parse XML morecarefully or use another way to retrieve children nodes
								var elems = response.serverResponse.responseXML.getElementsByTagName('entry');
								var nodes = [];
								for (i = 0; i < elems.length; i++)
								{
									var cmisObj = Alvex.util.getElementsByTagNameNS(elems[i], '*', 'cmisra', 'object')[0];
									var cmisProps = Alvex.util.getElementsByTagNameNS(cmisObj, '*', 'cmis', 'properties')[0];
									var idProp = Alvex.util.getElementsByTagNameNS(cmisProps, '*', 'cmis', 'propertyId')[0];
									var idVal = idProp.childNodes[0];
									var cmisId = Alvex.util.getElementText(idVal);
									nodes.push(cmisId);
								}
								YAHOO.Bubbling.fire('uploaderAddFilesReq', 
									{
										uploader: this.options.parentUploaderId,
										files: nodes.join(',')
									});
							},
							scope: this
						}
					}
				]
			});
		}
	});
})();
